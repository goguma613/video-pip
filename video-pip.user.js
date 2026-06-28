// ==UserScript==
// @name         🎬 고화질 영상 PIP (Picture-in-Picture)
// @name:en      HD Video Picture-in-Picture
// @namespace    https://github.com/goguma613/video-pip
// @version      1.2.5
// @description  영상을 항상 위에 뜨는 작은 창으로. Document PiP로 원본 화질 그대로 유지 + 커스텀 컨트롤(속도/볼륨/필터/줌·회전/스크린샷), 스크롤 시 자동 미니플레이어, 탭전환 자동 PIP(MediaSession), 미니 설정 팝오버, 상황별 프리셋, 단축키, 사이트별 설정 기억.
// @description:en  Pop any video into an always-on-top window at original quality with custom controls, presets, auto-PiP, hotkeys and per-site memory (Document Picture-in-Picture).
// @author       goguma613
// @match        *://*.youtube.com/*
// @match        *://*.youtube-nocookie.com/*
// @match        *://*.twitch.tv/*
// @match        *://*.vimeo.com/*
// @match        *://*.tv.naver.com/*
// @match        *://*.tv.kakao.com/*
// @match        *://*.afreecatv.com/*
// @match        *://*.chzzk.naver.com/*
// @exclude      *://*.netflix.com/*
// @exclude      *://*.disneyplus.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/goguma613/video-pip/main/video-pip.user.js
// @downloadURL  https://raw.githubusercontent.com/goguma613/video-pip/main/video-pip.user.js
// @homepageURL  https://github.com/goguma613/video-pip
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234f9dff'%3E%3Cpath d='M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z'/%3E%3C/svg%3E
// ==/UserScript==

/*
 * 고화질 영상 PIP
 * ─────────────────────────────────────────────────────────────
 * 단일 파일 안에서 역할별 모듈로 분리:
 *   ConfigManager   - 사이트(hostname)별 설정 저장/로드 (localStorage, debounce)
 *   VideoObserver   - MutationObserver + yt-navigate-finish로 video 등장/교체 감지, 대상 선택
 *   FilterEngine    - 밝기/대비/채도 + 줌/회전/미러를 video에 적용
 *   PipController   - ★핵심: Document PiP / 레거시 분기, video 이동·복원, PiP 창 컨트롤
 *   MiniPlayer      - 스크롤 이탈 시 원본 페이지 안에서 video를 떠다니는 미니창으로(제스처 불필요)
 *   HotkeyManager   - 단축키(설정 기반), YT 단축키 충돌 회피
 *   AutoPipManager  - 스크롤 이탈→미니플레이어(자동) / 탭 전환→MediaSession 자동 PIP
 *   UIManager       - 원본 페이지 Shadow DOM 플로팅 패널(진입·설정), 드래그/핀/페이드/온보딩
 *
 * 핵심 결정:
 *   주 엔진 = Document Picture-in-Picture (Chrome/Edge 116+) — 원본 <video>를 통째로
 *   새 창으로 옮겨 원본 해상도(4K 포함)를 손실 없이 유지하고 커스텀 UI를 입힘.
 *   폴백 = 레거시 video.requestPictureInPicture() (Firefox/Safari/모바일, 커스텀 컨트롤 없음).
 */

(function () {
  'use strict';

  // 최상위 프레임에서만 UI 렌더(임베드 iframe 중복 방지).
  const IS_TOP = (function () {
    try { if (window.frameElement) return false; } catch (e) { return false; }
    return true;
  })();
  if (!IS_TOP) return;

  // ─────────────────────────────────────────────────────────────
  // 상수
  // ─────────────────────────────────────────────────────────────
  const MIN_RATE = 0.25, MAX_RATE = 4;
  const SAVE_DEBOUNCE = 300;
  const CONTROLS_HIDE_MS = 2400;   // PiP 컨트롤 자동 숨김
  const SUPPORTS_DOC_PIP = 'documentPictureInPicture' in window;

  const DEFAULTS = {
    version: 1,
    // 재생
    defaultRate: 1,
    seekStep: 5,
    preservePitch: true,
    // 표시
    filters: { brightness: 100, contrast: 100, saturate: 100 }, // %
    zoom: 1, rotate: 0, mirror: false, fit: 'contain',          // contain | cover
    dim: 100,                                                   // 화면 디밍/투명도 (50~100%)
    subtitles: { enabled: true, size: 100, position: 'bottom', bg: 50 }, // 자막 따라오기
    // 창
    pipSize: { w: 480, h: 270 },
    activePreset: 'basic',
    // 자동 PIP
    autoPip: false,        // 마스터(탭전환 자동PIP + 스크롤 이탈 미니플레이어)
    miniCorner: 'br',      // 미니플레이어 스냅 위치: tl | tr | bl | br
    // 단축키 (정규화된 콤보)
    hotkeys: {
      togglePip: 'Alt+p', speedDown: '[', speedUp: ']',
      screenshot: 'Alt+s',
    },
    // UI
    collapsed: false,
    fadeWhenIdle: true,
    onboarded: false,
  };

  // 상황별 원클릭 프리셋 (크기 + 옵션 묶음). 클릭 시 적용 + PIP 켜기.
  const PRESETS = {
    basic: { label: '🎬 기본',  size: { w: 480, h: 270 }, rate: 1,    filters: { brightness: 100, contrast: 100, saturate: 100 }, zoom: 1, rotate: 0, fit: 'contain' },
    call:  { label: '📞 통화옆', size: { w: 320, h: 180 }, rate: 1,    filters: { brightness: 100, contrast: 100, saturate: 100 }, zoom: 1, rotate: 0, fit: 'contain' },
    paper: { label: '📖 논문',  size: { w: 320, h: 180 }, rate: 1.25, filters: { brightness: 100, contrast: 100, saturate: 100 }, zoom: 1, rotate: 0, fit: 'contain' },
    game:  { label: '🎮 공략',  size: { w: 400, h: 225 }, rate: 1,    filters: { brightness: 100, contrast: 100, saturate: 100 }, zoom: 1, rotate: 0, fit: 'contain' },
    music: { label: '🎧 음악',  size: { w: 240, h: 135 }, rate: 1,    filters: { brightness: 100, contrast: 100, saturate: 100 }, zoom: 1, rotate: 0, fit: 'contain' },
    night: { label: '🌙 야간',  size: { w: 480, h: 270 }, rate: 1,    filters: { brightness: 115, contrast: 110, saturate: 100 }, zoom: 1, rotate: 0, fit: 'contain' },
  };
  const PRESET_KEYS = ['basic', 'call', 'paper', 'game', 'music', 'night'];

  // ─────────────────────────────────────────────────────────────
  // 유틸
  // ─────────────────────────────────────────────────────────────
  function el(doc, tag, attrs, children) {
    const node = doc.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    if (children) children.forEach((c) => c && node.appendChild(c));
    return node;
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ─────────────────────────────────────────────────────────────
  // ConfigManager — 사이트별 설정 저장/로드
  // ─────────────────────────────────────────────────────────────
  const ConfigManager = (function () {
    const KEY = '__videoPip_cfg';
    let state = JSON.parse(JSON.stringify(DEFAULTS));
    let saveTimer = null;

    // 손상/구버전 값 방어: 타입·범위 정규화
    function sanitize(s) {
      const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
      s.defaultRate = clamp(num(s.defaultRate, 1), MIN_RATE, MAX_RATE);
      s.seekStep = clamp(num(s.seekStep, 5), 1, 60);
      s.zoom = clamp(num(s.zoom, 1), 1, 3);
      s.rotate = ((Math.round(num(s.rotate, 0) / 90) * 90) % 360 + 360) % 360;
      if (s.fit !== 'contain' && s.fit !== 'cover') s.fit = 'contain';
      const f = s.filters || {};
      s.filters = {
        brightness: clamp(num(f.brightness, 100), 0, 300),
        contrast: clamp(num(f.contrast, 100), 0, 300),
        saturate: clamp(num(f.saturate, 100), 0, 300),
      };
      const ps = s.pipSize || {};
      s.pipSize = { w: clamp(num(ps.w, 480) | 0, 200, 1920), h: clamp(num(ps.h, 270) | 0, 120, 1080) };
      s.dim = clamp(num(s.dim, 100), 50, 100);
      const sub = s.subtitles || {};
      s.subtitles = {
        enabled: sub.enabled !== false,
        size: clamp(num(sub.size, 100), 50, 200),
        position: sub.position === 'top' ? 'top' : 'bottom',
        bg: clamp(num(sub.bg, 50), 0, 100),
      };
      if (!s.hotkeys || typeof s.hotkeys !== 'object') s.hotkeys = Object.assign({}, DEFAULTS.hotkeys);
      if (!PRESETS[s.activePreset]) s.activePreset = 'basic';
      if (['tl', 'tr', 'bl', 'br'].indexOf(s.miniCorner) === -1) s.miniCorner = 'br';
      return s;
    }

    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          state = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), parsed);
          state.filters = Object.assign({}, DEFAULTS.filters, parsed.filters);
          state.hotkeys = Object.assign({}, DEFAULTS.hotkeys, parsed.hotkeys);
          state.pipSize = Object.assign({}, DEFAULTS.pipSize, parsed.pipSize);
        }
      } catch (e) { console.warn('[PIP] 설정 로드 실패:', e); }
      sanitize(state);
      return state;
    }
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(state)); }
      catch (e) { console.warn('[PIP] 설정 저장 실패:', e); }
    }
    function save() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, SAVE_DEBOUNCE); }

    return {
      get: () => state,
      set(patch) { Object.assign(state, patch); save(); },
      setFilters(patch) { state.filters = Object.assign({}, state.filters, patch); save(); },
      reset() { state = JSON.parse(JSON.stringify(DEFAULTS)); persist(); return state; },
      saveNow() { clearTimeout(saveTimer); persist(); },
      load,
    };
  })();

  // ─────────────────────────────────────────────────────────────
  // VideoObserver — video 등장/교체 감지 + 대상 선택
  // ─────────────────────────────────────────────────────────────
  const VideoObserver = (function () {
    let onChange = null;
    let manualPick = null; // 사용자가 멀티영상에서 고른 video(약참조 대용)

    function list() {
      return Array.from(document.querySelectorAll('video'))
        .filter((v) => v.isConnected && (v.videoWidth > 0 || v.readyState >= 1 || v.currentSrc));
    }

    // 대상 선택: 사용자가 고른 것 → 재생 중 최대 면적 → 최대 면적
    function pickActive() {
      const vids = list();
      if (!vids.length) return null;
      if (manualPick && manualPick.isConnected) return manualPick;
      manualPick = null;
      const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
      const playing = vids.filter((v) => !v.paused && !v.ended);
      const pool = playing.length ? playing : vids;
      return pool.sort((a, b) => area(b) - area(a))[0];
    }

    function setManual(v) { manualPick = v; if (onChange) onChange(pickActive()); }

    function start(cb) {
      onChange = cb;
      const root = document.documentElement || document;
      const mo = new MutationObserver((muts) => {
        let dirty = false;
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && (n.tagName === 'VIDEO' || (n.querySelector && n.querySelector('video')))) dirty = true;
          }
          for (const n of m.removedNodes) {
            if (n.nodeType === 1 && (n.tagName === 'VIDEO' || (n.querySelector && n.querySelector('video')))) dirty = true;
          }
        }
        if (dirty && onChange) onChange(pickActive());
      });
      mo.observe(root, { childList: true, subtree: true });

      // 유튜브 SPA 영상 전환
      window.addEventListener('yt-navigate-finish', () => {
        manualPick = null;
        setTimeout(() => onChange && onChange(pickActive()), 400);
      });
      document.addEventListener('DOMContentLoaded', () => onChange && onChange(pickActive()), { once: true });
      // 정적 <video>가 뒤늦게(또는 DOM 변화 없이) 재생을 시작하는 사이트 대응 → 재생 시점에 재바인딩
      document.addEventListener('play', () => onChange && onChange(pickActive()), { capture: true });
    }

    return { start, pickActive, list, setManual };
  })();

  // ─────────────────────────────────────────────────────────────
  // FilterEngine — 밝기/대비/채도 + 줌/회전/미러
  // ─────────────────────────────────────────────────────────────
  const FilterEngine = {
    apply(video, cfg) {
      if (!video) return;
      const f = cfg.filters;
      video.style.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%)`;
      const t = [];
      if (cfg.zoom !== 1) t.push(`scale(${cfg.zoom})`);
      if (cfg.rotate) t.push(`rotate(${cfg.rotate}deg)`);
      if (cfg.mirror) t.push('scaleX(-1)');
      video.style.transform = t.join(' ');
      video.style.transformOrigin = 'center center';
      video.style.objectFit = cfg.fit;
      video.style.opacity = (cfg.dim == null ? 100 : cfg.dim) / 100;
    },
    clear(video) {
      if (!video) return;
      video.style.filter = '';
      video.style.transform = '';
      video.style.objectFit = '';
      video.style.opacity = '';
    },
  };

  // ─────────────────────────────────────────────────────────────
  // SubtitleEngine — 사이트 자막을 PiP 창으로 가져와 렌더
  //   ① 네이티브 textTrack(cuechange) ② 유튜브 자막 DOM 미러(폴백)
  // ─────────────────────────────────────────────────────────────
  const SubtitleEngine = (function () {
    let active = null; // { video, target, tracks:[[tr,fn,mode]], poll }

    function styleTarget(target, cfg) {
      const s = cfg.subtitles;
      target.style.display = s.enabled ? 'block' : 'none';
      target.style.fontSize = (s.size / 100 * 1.8) + 'vw';
      target.classList.toggle('top', s.position === 'top');
      target.style.background = s.bg > 0 ? `rgba(0,0,0,${s.bg / 100})` : 'transparent';
    }
    function setText(target, txt) {
      target.textContent = txt || '';
      target.style.visibility = txt ? 'visible' : 'hidden';
    }
    function strip(t) { return (t || '').replace(/<[^>]+>/g, '').trim(); }

    function update() {
      if (!active) return;
      let txt = '';
      for (const [tr] of active.tracks) {
        const cues = tr.activeCues;
        if (cues && cues.length) { for (let i = 0; i < cues.length; i++) txt += strip(cues[i].text) + '\n'; }
      }
      txt = txt.trim();
      if (!txt) { // 유튜브 자막 DOM 폴백
        const segs = document.querySelectorAll('.ytp-caption-segment');
        if (segs.length) { let t = ''; segs.forEach((s) => t += s.textContent + '\n'); txt = t.trim(); }
      }
      setText(active.target, txt);
    }

    function start(video, target, cfg) {
      stop();
      active = { video, target, tracks: [], poll: null };
      styleTarget(target, cfg);
      const tracks = video.textTracks || [];
      const bind = () => {
        for (let i = 0; i < tracks.length; i++) {
          const tr = tracks[i];
          if (tr.kind !== 'captions' && tr.kind !== 'subtitles') continue;
          if (tr.mode === 'disabled') continue;          // 사용자가 끈 자막은 강제로 켜지 않음
          if (active.tracks.some(([t]) => t === tr)) continue;
          const orig = tr.mode;
          tr.mode = 'hidden';                              // 네이티브 렌더 끄고 cue만 수신
          const fn = update;
          tr.addEventListener('cuechange', fn);
          active.tracks.push([tr, fn, orig]);
        }
      };
      bind();
      try { tracks.addEventListener && tracks.addEventListener('addtrack', bind); active._bind = bind; active._tracks = tracks; } catch (e) {}
      active.poll = setInterval(() => { bind(); update(); }, 300); // YT DOM + 늦게 뜨는 트랙 대응
      if (!cfg.subtitles.enabled) setText(target, '');
    }
    function restyle(cfg) { if (active) styleTarget(active.target, cfg); }
    function stop() {
      if (!active) return;
      active.tracks.forEach(([tr, fn, orig]) => { try { tr.removeEventListener('cuechange', fn); tr.mode = orig; } catch (e) {} });
      try { active._tracks && active._tracks.removeEventListener && active._tracks.removeEventListener('addtrack', active._bind); } catch (e) {}
      clearInterval(active.poll);
      active = null;
    }
    return { start, stop, restyle };
  })();

  // ─────────────────────────────────────────────────────────────
  // SleepTimer — N분 후 정지 / 영상 끝나면 닫기
  // ─────────────────────────────────────────────────────────────
  const SleepTimer = (function () {
    let t = null, endFn = null, vid = null, mode = 'off';
    function clear() {
      if (t) { clearTimeout(t); t = null; }
      if (endFn && vid) { try { vid.removeEventListener('ended', endFn); } catch (e) {} }
      endFn = null; vid = null; mode = 'off';
    }
    function set(m) {
      clear();
      mode = m || 'off';
      if (mode === 'off') return;
      vid = PipController.getVideo();
      if (!vid) { Toast.show('💤 영상을 먼저 재생한 뒤 슬립 타이머를 설정하세요.'); mode = 'off'; return; }
      if (mode === 'end') {
        endFn = () => { Toast.show('💤 영상이 끝나 PIP를 닫습니다.'); PipController.exit(); };
        vid.addEventListener('ended', endFn, { once: true });
        Toast.show('💤 영상이 끝나면 PIP를 닫습니다.');
        return;
      }
      const min = parseInt(mode, 10);
      if (min > 0) {
        t = setTimeout(() => { const v = PipController.getVideo(); if (v) v.pause(); Toast.show('💤 슬립 타이머 — 영상을 일시정지했어요.'); t = null; mode = 'off'; }, min * 60000);
        Toast.show('💤 ' + min + '분 후 자동으로 일시정지합니다.');
      }
    }
    return { set, clear, get mode() { return mode; } };
  })();

  // ─────────────────────────────────────────────────────────────
  // PipController — 핵심: 진입/복원 + PiP 창 컨트롤
  // ─────────────────────────────────────────────────────────────
  const PipController = (function () {
    let current = null; // { mode:'doc'|'legacy', win, video, origin, ctrl }
    let onStateChange = null;
    let autoEntered = false;

    const PIP_CSS = `
      *{box-sizing:border-box;margin:0;padding:0;}
      html,body{width:100%;height:100%;background:#000;overflow:hidden;
        font-family:'Malgun Gothic',system-ui,-apple-system,sans-serif;color:#e9eef5;}
      .stage{position:fixed;inset:0;background:#000;overflow:hidden;}
      .slot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;}
      .vpip-video{position:static!important;width:100%!important;height:100%!important;
        max-width:none!important;max-height:none!important;inset:auto!important;left:auto!important;
        top:auto!important;right:auto!important;bottom:auto!important;margin:0!important;}
      .overlay{position:absolute;inset:0;opacity:0;transition:opacity .14s ease;pointer-events:none;}
      .overlay.show{opacity:1;pointer-events:auto;}
      .topbar{position:absolute;top:0;left:0;right:0;height:46px;display:flex;align-items:center;gap:8px;
        padding:0 10px;background:linear-gradient(180deg,rgba(0,0,0,.6),transparent);}
      .ttl{flex:1;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9;}
      .center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:26px;pointer-events:none;}
      .center .cbtn{pointer-events:auto;}
      .cbtn{width:46px;height:46px;border:none;border-radius:50%;cursor:pointer;font-size:20px;
        background:rgba(20,24,32,.55);color:#fff;display:flex;align-items:center;justify-content:center;}
      .cbtn.big{width:60px;height:60px;font-size:26px;}
      .cbtn:hover{background:rgba(79,157,255,.85);}
      .ibtn{width:30px;height:30px;border:none;border-radius:8px;cursor:pointer;background:transparent;
        color:#e9eef5;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;}
      .ibtn:hover{color:#4f9dff;background:rgba(255,255,255,.08);}
      .ibtn.close:hover{color:#ff5b5b;}
      .bottom{position:absolute;left:0;right:0;bottom:0;padding:0 12px 8px;
        background:linear-gradient(0deg,rgba(0,0,0,.65),transparent);}
      .seek{position:relative;height:22px;display:flex;align-items:center;cursor:pointer;}
      .track{position:relative;height:4px;width:100%;border-radius:4px;background:rgba(255,255,255,.18);overflow:hidden;}
      .seek:hover .track{height:6px;}
      .buffered{position:absolute;left:0;top:0;height:100%;background:rgba(255,255,255,.28);width:0;}
      .played{position:absolute;left:0;top:0;height:100%;background:#4f9dff;width:0;}
      .thumb{position:absolute;top:50%;width:12px;height:12px;border-radius:50%;background:#4f9dff;
        transform:translate(-50%,-50%);left:0;box-shadow:0 1px 4px rgba(0,0,0,.5);opacity:.5;transition:opacity .12s;}
      .seek:hover .thumb{opacity:1;}
      .tip{position:absolute;bottom:18px;transform:translateX(-50%);background:rgba(20,24,32,.95);
        padding:2px 6px;border-radius:6px;font-size:11px;white-space:nowrap;display:none;}
      .row{display:flex;align-items:center;gap:6px;height:34px;}
      .time{font-size:12px;color:#cfd8e3;min-width:90px;}
      .spd{font-size:12px;font-weight:700;padding:3px 7px;border:none;border-radius:7px;cursor:pointer;
        background:rgba(255,255,255,.08);color:#e9eef5;}
      .spd.boost{color:#ffb84f;}
      .vol{-webkit-appearance:none;appearance:none;width:72px;height:4px;border-radius:4px;
        background:rgba(255,255,255,.18);outline:none;}
      .vol::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#fff;cursor:pointer;}
      .grow{flex:1;}
      .hint{position:absolute;left:50%;bottom:48px;transform:translateX(-50%);background:#4f9dff;color:#fff;
        font-size:12px;padding:8px 12px;border-radius:10px;max-width:90%;line-height:1.5;box-shadow:0 6px 18px rgba(0,0,0,.4);}
      .hint button{display:block;margin:6px auto 0;background:rgba(255,255,255,.25);border:none;color:#fff;
        border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px;}
      .subs{position:absolute;left:50%;bottom:11%;transform:translateX(-50%);max-width:92%;text-align:center;
        color:#fff;font-weight:600;line-height:1.35;text-shadow:0 1px 3px rgba(0,0,0,.95);padding:1px 8px;
        border-radius:6px;white-space:pre-wrap;pointer-events:none;z-index:5;}
      .subs.top{bottom:auto;top:8%;}
      button:focus-visible,input:focus-visible{outline:2px solid #4f9dff;outline-offset:2px;}
      .stage.mini .center .cbtn:not(.big){display:none;}
      .stage.mini .cbtn.big{width:46px;height:46px;font-size:20px;}
      .stage.mini .time{min-width:0;}
      .stage.mini .vol{width:48px;}
      .stage.compact .center{display:none;}
      .stage.compact .opt-hide{display:none;}
      .stage.compact .vol{display:none;}
      .pop{position:absolute;right:10px;bottom:54px;width:210px;background:rgba(22,26,34,.97);
        border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:11px;display:none;z-index:10;
        box-shadow:0 8px 24px rgba(0,0,0,.5);}
      .pop.show{display:block;}
      .pop .pr{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:11px;}
      .pop .pr .pl{width:34px;opacity:.7;}
      .pop .pr input[type=range]{-webkit-appearance:none;appearance:none;flex:1;height:4px;border-radius:4px;
        background:rgba(255,255,255,.18);outline:none;}
      .pop .pr input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#4f9dff;cursor:pointer;}
      .pop .pr .pv{width:44px;text-align:right;color:#4f9dff;font-weight:700;}
      .pop .prow{display:flex;gap:5px;margin-top:9px;}
      .pop .pbtn2{flex:1;padding:6px 0;border:none;border-radius:7px;background:rgba(255,255,255,.08);color:#e9eef5;font-size:11px;cursor:pointer;}
      .pop .pbtn2:hover{background:rgba(255,255,255,.16);}
      .pop .pbtn2.active{background:#4f9dff;color:#fff;}
      .help{position:absolute;inset:0;background:rgba(0,0,0,.85);display:none;z-index:20;padding:18px 20px;overflow:auto;}
      .help.show{display:block;}
      .help h4{font-size:13px;margin:0 0 10px;color:#4f9dff;}
      .help .hk{font-size:12px;line-height:1.95;}
      .help .hk b{display:inline-block;min-width:78px;color:#4f9dff;}
      .help .hclose{position:absolute;top:10px;right:12px;}
    `;

    function isActive() { return !!current; }
    function getVideo() { return current ? current.video : null; }
    function setOnStateChange(fn) { onStateChange = fn; }
    function notify() { if (onStateChange) onStateChange(isActive()); }

    // ── 진입 ──
    async function enter(video, opts) {
      video = video || MiniPlayer.getVideo() || VideoObserver.pickActive();
      if (!video) { Toast.show('🔍 이 페이지에서 영상을 찾지 못했어요. 영상을 한 번 재생한 뒤 다시 시도해 주세요.'); return; }
      if (current) await exit();
      try { MiniPlayer.exit(); } catch (e) {} // 미니플레이어가 잡고 있던 video를 원위치로 회수 후 진입
      autoEntered = !!(opts && opts.auto);
      const cfg = ConfigManager.get();

      if (SUPPORTS_DOC_PIP) {
        try {
          const w = clamp(cfg.pipSize.w | 0, 200, 1920);
          const h = clamp(cfg.pipSize.h | 0, 120, 1080);
          const pipWin = await documentPictureInPicture.requestWindow({ width: w, height: h });
          try { mountDoc(pipWin, video, cfg); }
          catch (err) { console.error('[PIP] PiP 구성 실패, 복원 시도:', err); try { restore(); } catch (e2) {} try { pipWin.close(); } catch (e2) {} }
          return;
        } catch (e) {
          console.warn('[PIP] Document PiP 실패, 레거시 시도:', e && e.message);
        }
      }
      // 폴백: 레거시
      try {
        if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
          video.playbackRate = cfg.defaultRate;
          await video.requestPictureInPicture();
          current = { mode: 'legacy', video };
          video.addEventListener('leavepictureinpicture', () => { current = null; notify(); }, { once: true });
          notify();
          Toast.show('ℹ️ 이 브라우저는 기본 PIP로 동작합니다(커스텀 컨트롤은 Chrome/Edge에서 지원).');
        } else {
          Toast.show('이 브라우저/영상은 PIP를 지원하지 않습니다.');
        }
      } catch (e) {
        Toast.show('PIP를 열 수 없습니다: ' + (e && e.message || e));
      }
    }

    function mountDoc(pipWin, video, cfg) {
      // 1) 원위치 기억(자리표시자 + 인라인 스타일 스냅샷)
      const anchor = document.createComment('vpip-anchor');
      video.parentNode.insertBefore(anchor, video);
      const origin = { anchor, parent: video.parentNode, styleSnap: video.getAttribute('style') };

      // 2) 스타일(adoptedStyleSheets — 사이트 CSP 회피)
      try {
        const sheet = new pipWin.CSSStyleSheet();
        sheet.replaceSync(PIP_CSS);
        pipWin.document.adoptedStyleSheets = [sheet];
      } catch (e) {
        const st = pipWin.document.createElement('style'); st.textContent = PIP_CSS;
        pipWin.document.head.appendChild(st);
      }

      // 3) 스테이지/컨트롤 구성(이 시점엔 video가 아직 원위치)
      const ctrl = buildStage(pipWin, video, cfg);

      // 4) current·복원 핸들러를 video 이동 "전에" 등록(구성 중 throw 대비)
      current = { mode: 'doc', win: pipWin, video, origin, ctrl };
      pipWin.addEventListener('pagehide', () => restore(), { once: true });

      // 5) 실제 video를 PiP 창으로 이동
      video.classList.add('vpip-video');
      ctrl.slot.appendChild(video); // ★ 원본 video를 PiP 창으로 이동
      video.playbackRate = cfg.defaultRate;
      try { video.preservesPitch = cfg.preservePitch; } catch (e) {}
      FilterEngine.apply(video, cfg);
      SubtitleEngine.start(video, ctrl.subs, cfg);

      notify();
    }

    // ── PiP 창 내부 컨트롤 ──
    function buildStage(pipWin, video, cfg) {
      const doc = pipWin.document;
      const stage = el(doc, 'div', { class: 'stage' });
      const slot = el(doc, 'div', { class: 'slot' });

      // 상단바
      const ttl = el(doc, 'span', { class: 'ttl', text: document.title || location.hostname });
      const homeBtn = el(doc, 'button', { class: 'ibtn', title: '페이지로 돌아가기', 'aria-label': '페이지로 돌아가기', text: '🏠' });
      const sizeBtn = el(doc, 'button', { class: 'ibtn', title: '창 크기 전환', 'aria-label': '창 크기 전환', text: '⤢' });
      const helpBtn = el(doc, 'button', { class: 'ibtn', title: '도움말 (?)', 'aria-label': '도움말', text: '❓' });
      const closeBtn = el(doc, 'button', { class: 'ibtn close', title: '닫기 (Esc)', 'aria-label': '닫기', text: '✕' });
      const topbar = el(doc, 'div', { class: 'topbar' }, [ttl, sizeBtn, helpBtn, homeBtn, closeBtn]);

      // 중앙
      const backBtn = el(doc, 'button', { class: 'cbtn', title: '10초 뒤로', 'aria-label': '10초 뒤로', text: '⟲' });
      const playC = el(doc, 'button', { class: 'cbtn big', title: '재생/일시정지', 'aria-label': '재생/일시정지', text: '⏸' });
      const fwdBtn = el(doc, 'button', { class: 'cbtn', title: '10초 앞으로', 'aria-label': '10초 앞으로', text: '⟳' });
      const center = el(doc, 'div', { class: 'center' }, [backBtn, playC, fwdBtn]);

      // 하단: 시크바
      const buffered = el(doc, 'div', { class: 'buffered' });
      const played = el(doc, 'div', { class: 'played' });
      const thumb = el(doc, 'div', { class: 'thumb' });
      const track = el(doc, 'div', { class: 'track' }, [buffered, played, thumb]);
      const tip = el(doc, 'div', { class: 'tip' });
      const seek = el(doc, 'div', { class: 'seek' }, [track, tip]);

      // 하단: 컨트롤 행
      const playB = el(doc, 'button', { class: 'ibtn', title: '재생/일시정지 (Space)', 'aria-label': '재생/일시정지', text: '⏸' });
      const time = el(doc, 'span', { class: 'time', text: '0:00 / 0:00' });
      const muteB = el(doc, 'button', { class: 'ibtn', title: '음소거 (M)', 'aria-label': '음소거', text: '🔊' });
      const vol = el(doc, 'input', { class: 'vol', type: 'range', min: '0', max: '100', 'aria-label': '볼륨', value: String(Math.round(video.volume * 100)) });
      const spd = el(doc, 'button', { class: 'spd', title: '재생 속도 (클릭하여 순환)', 'aria-label': '재생 속도', text: cfg.defaultRate.toFixed(2) + 'x' });
      const shot = el(doc, 'button', { class: 'ibtn opt-hide', title: '스크린샷 (S)', 'aria-label': '스크린샷', text: '📷' });
      const rotB = el(doc, 'button', { class: 'ibtn opt-hide', title: '90° 회전 (R)', 'aria-label': '90도 회전', text: '🔄' });
      const gearB = el(doc, 'button', { class: 'ibtn opt-hide', title: '설정 (배속·필터·회전)', 'aria-label': '설정', text: '⚙️' });
      const row = el(doc, 'div', { class: 'row' }, [playB, time, el(doc, 'span', { class: 'grow' }), muteB, vol, spd, rotB, shot, gearB]);

      const bottom = el(doc, 'div', { class: 'bottom' }, [seek, row]);
      const pop = buildPopover(doc, video);
      const help = buildHelp(doc);
      const subs = el(doc, 'div', { class: 'subs' + (cfg.subtitles.position === 'top' ? ' top' : '') });
      const overlay = el(doc, 'div', { class: 'overlay' }, [topbar, center, bottom]);

      stage.appendChild(slot);
      stage.appendChild(subs);
      stage.appendChild(overlay);
      stage.appendChild(pop.root);
      stage.appendChild(help.root);
      doc.body.appendChild(stage);

      // 창 너비에 따른 컨트롤 단계 축소
      const applyCompact = () => { const w = pipWin.innerWidth || 480; stage.classList.toggle('mini', w < 360); stage.classList.toggle('compact', w < 250); };
      pipWin.addEventListener('resize', applyCompact); applyCompact();

      const vListeners = [];
      const onV = (type, fn) => { video.addEventListener(type, fn); vListeners.push([type, fn]); };
      const ctrl = { slot, overlay, playC, playB, time, seek, track, played, buffered, thumb, tip, spd, vol, muteB, subs, vListeners };

      // ── 이벤트 ──
      const togglePlay = () => { video.paused ? video.play() : video.pause(); };
      playC.addEventListener('click', togglePlay);
      playB.addEventListener('click', togglePlay);
      backBtn.addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); });
      fwdBtn.addEventListener('click', () => { video.currentTime += 10; });
      homeBtn.addEventListener('click', () => { try { pipWin.close(); } catch (e) {} try { window.focus(); } catch (e) {} });
      closeBtn.addEventListener('click', () => { try { pipWin.close(); } catch (e) {} });
      sizeBtn.addEventListener('click', () => {
        const c = ConfigManager.get();
        const big = c.pipSize.w < 700;
        const nw = big ? 900 : 480, nh = big ? 506 : 270;
        ConfigManager.set({ pipSize: { w: nw, h: nh } });
        try { pipWin.resizeTo(nw, nh); } catch (e) {}
      });
      rotB.addEventListener('click', () => {
        const c = ConfigManager.get();
        ConfigManager.set({ rotate: (c.rotate + 90) % 360 });
        FilterEngine.apply(video, ConfigManager.get());
      });
      shot.addEventListener('click', () => screenshot(video));
      gearB.addEventListener('click', (e) => { e.stopPropagation(); help.root.classList.remove('show'); pop.root.classList.toggle('show'); pop.sync(); });
      helpBtn.addEventListener('click', (e) => { e.stopPropagation(); pop.root.classList.remove('show'); help.root.classList.toggle('show'); });
      help.closeBtn.addEventListener('click', () => help.root.classList.remove('show'));
      muteB.addEventListener('click', () => { video.muted = !video.muted; });
      vol.addEventListener('input', () => { video.volume = vol.value / 100; video.muted = false; });
      spd.addEventListener('click', () => cycleRate(video));

      // 시크 드래그
      let seeking = false;
      const seekToClient = (clientX) => {
        const r = track.getBoundingClientRect();
        const ratio = clamp((clientX - r.left) / r.width, 0, 1);
        if (isFinite(video.duration)) video.currentTime = ratio * video.duration;
        return ratio;
      };
      seek.addEventListener('pointerdown', (e) => {
        seeking = true; seek.setPointerCapture(e.pointerId); seekToClient(e.clientX);
      });
      seek.addEventListener('pointermove', (e) => {
        const r = track.getBoundingClientRect();
        const ratio = clamp((e.clientX - r.left) / r.width, 0, 1);
        tip.style.display = 'block';
        tip.style.left = (ratio * 100) + '%';
        tip.textContent = fmtTime(ratio * (video.duration || 0));
        if (seeking) seekToClient(e.clientX);
      });
      seek.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
      const endSeek = () => { seeking = false; };
      seek.addEventListener('pointerup', endSeek);
      seek.addEventListener('pointercancel', endSeek);
      seek.addEventListener('lostpointercapture', endSeek);
      pipWin.addEventListener('pointerup', endSeek);

      // 영상 빈 영역 단일클릭 = 재생토글 / 더블클릭 = 크기 토글 (컨트롤 버튼 클릭은 제외)
      let clickTimer = null;
      overlay.addEventListener('click', (e) => {
        if (e.target !== overlay && !e.target.classList.contains('center')) return;
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; sizeBtn.click(); return; }
        clickTimer = setTimeout(() => { clickTimer = null; togglePlay(); }, 250);
      });
      // 컨트롤이 숨겨진 상태에서 클릭/터치 시 다시 표시
      stage.addEventListener('click', () => { if (!overlay.classList.contains('show')) showControls(); });

      // 휠: 볼륨 / Shift+휠: 속도
      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.shiftKey) { nudgeRate(video, e.deltaY < 0 ? 0.1 : -0.1); }
        else { video.volume = clamp(video.volume + (e.deltaY < 0 ? 0.05 : -0.05), 0, 1); video.muted = false; vol.value = String(Math.round(video.volume * 100)); }
      }, { passive: false });

      // 호버 등장 / 자동 숨김
      let hideTimer = null;
      const showControls = () => {
        overlay.classList.add('show');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { if (!video.paused && !seeking) overlay.classList.remove('show'); }, CONTROLS_HIDE_MS);
      };
      stage.addEventListener('pointermove', showControls);
      stage.addEventListener('pointerenter', showControls);
      stage.addEventListener('pointerleave', () => { if (!video.paused && !seeking) overlay.classList.remove('show'); });
      onV('pause', () => overlay.classList.add('show'));
      showControls();

      // 상태 동기화
      const syncPlay = () => { const p = video.paused; const t = p ? '▶' : '⏸'; playC.textContent = t; playB.textContent = t; const lbl = p ? '재생' : '일시정지'; playC.setAttribute('aria-label', lbl); playB.setAttribute('aria-label', lbl); };
      const syncVol = () => { const m = video.muted || video.volume === 0; muteB.textContent = m ? '🔇' : '🔊'; muteB.setAttribute('aria-label', m ? '음소거 해제' : '음소거'); };
      onV('play', syncPlay);
      onV('pause', syncPlay);
      onV('volumechange', () => { syncVol(); vol.value = String(Math.round(video.volume * 100)); });
      syncPlay(); syncVol();

      // 진행 업데이트 루프(PiP 창 rAF — 닫히면 자동 종료)
      function tick() {
        if (!current || current.win !== pipWin) return;
        const dur = video.duration;
        if (isFinite(dur) && dur > 0) {
          const r = video.currentTime / dur;
          played.style.width = (r * 100) + '%';
          thumb.style.left = (r * 100) + '%';
          if (video.buffered.length) {
            buffered.style.width = (video.buffered.end(video.buffered.length - 1) / dur * 100) + '%';
          }
          time.textContent = fmtTime(video.currentTime) + ' / ' + fmtTime(dur);
        } else {
          time.textContent = '● LIVE';
          played.style.width = '100%';
        }
        ctrl.spd.textContent = video.playbackRate.toFixed(2) + 'x';
        ctrl.spd.classList.toggle('boost', video.playbackRate !== 1);
        pipWin.requestAnimationFrame(tick);
      }
      pipWin.requestAnimationFrame(tick);

      // 첫 진입 힌트(1회)
      if (!ConfigManager.get().onboarded) {
        const close = el(doc, 'button', { text: '알겠어요' });
        const hint = el(doc, 'div', { class: 'hint' }, [
          el(doc, 'div', { text: '💡 마우스를 올리면 컨트롤이 나타나요 · 휠=볼륨, Shift+휠=배속 · Esc로 닫기' }),
          close,
        ]);
        stage.appendChild(hint);
        close.addEventListener('click', () => { hint.remove(); ConfigManager.set({ onboarded: true }); ConfigManager.saveNow(); });
        setTimeout(() => hint.remove(), 8000);
      }

      // PiP 창 자체 단축키
      HotkeyManager.attach(doc);
      doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (pop.root.classList.contains('show') || help.root.classList.contains('show')) {
            pop.root.classList.remove('show'); help.root.classList.remove('show'); e.stopImmediatePropagation(); return;
          }
          try { pipWin.close(); } catch (err) {}
        } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
          pop.root.classList.remove('show'); help.root.classList.toggle('show'); e.preventDefault();
        }
      });

      return ctrl;
    }

    // PiP 창 안 미니 설정 팝오버(배속·밝기·대비·채도·회전·반전)
    function buildPopover(doc, video) {
      const cfg = ConfigManager.get();
      const apply = () => FilterEngine.apply(video, ConfigManager.get());
      function prow(label, min, max, step, val, fmt, onInput) {
        const input = el(doc, 'input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val), 'aria-label': label });
        const pv = el(doc, 'span', { class: 'pv', text: fmt(val) });
        input.addEventListener('input', () => { const v = parseFloat(input.value); pv.textContent = fmt(v); onInput(v); });
        const root = el(doc, 'div', { class: 'pr' }, [el(doc, 'span', { class: 'pl', text: label }), input, pv]);
        return { root, set(v) { input.value = String(v); pv.textContent = fmt(v); } };
      }
      const rate = prow('배속', MIN_RATE, MAX_RATE, 0.05, video.playbackRate, (v) => v.toFixed(2) + 'x', (v) => { video.playbackRate = v; ConfigManager.set({ defaultRate: v }); });
      const bri = prow('밝기', 50, 150, 1, cfg.filters.brightness, (v) => v + '%', (v) => { ConfigManager.setFilters({ brightness: v }); apply(); });
      const con = prow('대비', 50, 150, 1, cfg.filters.contrast, (v) => v + '%', (v) => { ConfigManager.setFilters({ contrast: v }); apply(); });
      const sat = prow('채도', 0, 200, 1, cfg.filters.saturate, (v) => v + '%', (v) => { ConfigManager.setFilters({ saturate: v }); apply(); });
      const rotBtn = el(doc, 'button', { class: 'pbtn2', text: '🔄 회전' });
      const mirBtn = el(doc, 'button', { class: 'pbtn2' + (cfg.mirror ? ' active' : ''), text: '↔ 반전' });
      const resetBtn = el(doc, 'button', { class: 'pbtn2', text: '↺ 초기화' });
      rotBtn.addEventListener('click', () => { const c = ConfigManager.get(); ConfigManager.set({ rotate: (c.rotate + 90) % 360 }); apply(); });
      mirBtn.addEventListener('click', () => { const c = ConfigManager.get(); ConfigManager.set({ mirror: !c.mirror }); mirBtn.classList.toggle('active', !c.mirror); apply(); });
      resetBtn.addEventListener('click', () => {
        ConfigManager.set({ rotate: 0, mirror: false, zoom: 1 });
        ConfigManager.setFilters({ brightness: 100, contrast: 100, saturate: 100 });
        bri.set(100); con.set(100); sat.set(100); mirBtn.classList.remove('active'); apply();
      });
      const prowBtns = el(doc, 'div', { class: 'prow' }, [rotBtn, mirBtn, resetBtn]);
      const root = el(doc, 'div', { class: 'pop' }, [rate.root, bri.root, con.root, sat.root, prowBtns]);
      root.addEventListener('click', (e) => e.stopPropagation());
      // 외부 상태 변화(휠 배속 등) 반영용
      function sync() {
        const c = ConfigManager.get();
        rate.set(video.playbackRate);
        bri.set(c.filters.brightness); con.set(c.filters.contrast); sat.set(c.filters.saturate);
        mirBtn.classList.toggle('active', !!c.mirror);
      }
      return { root, sync };
    }

    // 단축키 도움말 오버레이
    function buildHelp(doc) {
      const closeBtn = el(doc, 'button', { class: 'ibtn close hclose', title: '닫기', 'aria-label': '도움말 닫기', text: '✕' });
      const keyData = [
        ['Space / K', '재생·일시정지'], ['← / →', '5초 이동'], ['J / L', '10초 이동'],
        ['↑ / ↓', '볼륨'], ['M', '음소거'], ['[ / ] / =', '배속 −/＋ · 리셋'],
        ['R / F / S', '회전 · 크기 · 스크린샷'], ['휠', '볼륨'], ['Shift+휠', '배속'],
        ['?', '이 도움말'], ['Esc', '닫기'],
      ];
      const hk = el(doc, 'div', { class: 'hk' });
      keyData.forEach(([k, d]) => hk.appendChild(el(doc, 'div', {}, [el(doc, 'b', { text: k }), el(doc, 'span', { text: ' ' + d })])));
      const root = el(doc, 'div', { class: 'help' }, [closeBtn, el(doc, 'h4', { text: '⌨️ 단축키' }), hk]);
      root.addEventListener('click', (e) => { if (e.target === root) root.classList.remove('show'); });
      return { root, closeBtn };
    }

    function cycleRate(video) {
      const steps = [0.5, 1, 1.25, 1.5, 2];
      const cur = video.playbackRate;
      let next = steps.find((s) => s > cur + 0.001);
      if (next === undefined) next = steps[0];
      video.playbackRate = next;
      ConfigManager.set({ defaultRate: next });
    }
    function nudgeRate(video, d) {
      const next = clamp(Math.round((video.playbackRate + d) * 100) / 100, MIN_RATE, MAX_RATE);
      video.playbackRate = next;
      ConfigManager.set({ defaultRate: next });
    }

    function screenshot(video) {
      try {
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        c.toBlob((blob) => {
          if (!blob) { Toast.show('스크린샷 캡처 실패(보호된 영상).'); return; }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'screenshot_' + Math.floor(video.currentTime) + 's.png';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }, 'image/png');
      } catch (e) {
        Toast.show('스크린샷 캡처 불가(DRM/교차출처 영상).');
      }
    }

    // ── 복원 ──
    function restore() {
      SubtitleEngine.stop();
      SleepTimer.clear();
      if (!current || current.mode !== 'doc') { current = null; notify(); return; }
      const { video, origin } = current;
      try {
        if (current.ctrl && current.ctrl.vListeners) {
          current.ctrl.vListeners.forEach(([type, fn]) => video.removeEventListener(type, fn));
        }
        video.classList.remove('vpip-video');
        FilterEngine.clear(video);
        if (origin.anchor && origin.anchor.parentNode) {
          origin.anchor.parentNode.insertBefore(video, origin.anchor);
          origin.anchor.remove();
        } else if (origin.parent && origin.parent.isConnected) {
          origin.parent.appendChild(video);
        }
        if (origin.styleSnap == null) video.removeAttribute('style');
        else video.setAttribute('style', origin.styleSnap);
      } catch (e) { console.warn('[PIP] 복원 중 오류:', e); }
      current = null;
      autoEntered = false;
      notify();
    }

    async function exit() {
      if (!current) return;
      if (current.mode === 'doc' && current.win) { try { current.win.close(); } catch (e) {} restore(); }
      else if (current.mode === 'legacy') { try { await document.exitPictureInPicture(); } catch (e) {} current = null; notify(); }
    }

    async function toggle(opts) { if (current) await exit(); else await enter(null, opts); }

    function tryResize(w, h) {
      if (current && current.mode === 'doc' && current.win) { try { current.win.resizeTo(w, h); } catch (e) {} }
    }

    // SPA 전환/플레이어 재생성 시 새 video로 재바인딩
    function onActiveVideoChanged(newVideo) {
      if (!current || current.mode !== 'doc' || !newVideo) return;
      if (current.video === newVideo && newVideo.isConnected) return;
      if (current.video && current.video.isConnected) return; // 기존이 살아있으면 유지
      const oldT = current.video ? current.video.currentTime : 0;
      const cfg = ConfigManager.get();
      // ★ 옮기기 "전에" 새 원위치(anchor)를 DOM에 삽입하고 인라인 스타일 스냅샷 저장 (복원 보장)
      const anchor = document.createComment('vpip-anchor');
      if (newVideo.parentNode) newVideo.parentNode.insertBefore(anchor, newVideo);
      current.origin = { anchor, parent: anchor.parentNode || document.body, styleSnap: newVideo.getAttribute('style') };
      newVideo.classList.add('vpip-video');
      current.ctrl.slot.appendChild(newVideo);
      try { newVideo.currentTime = oldT; } catch (e) {}
      newVideo.playbackRate = cfg.defaultRate;
      FilterEngine.apply(newVideo, cfg);
      current.video = newVideo;
    }

    return { enter, exit, toggle, isActive, getVideo, setOnStateChange, tryResize, onActiveVideoChanged, screenshot, cycleRate, nudgeRate, get isAuto() { return autoEntered; } };
  })();

  // ─────────────────────────────────────────────────────────────
  // MiniPlayer — 스크롤 이탈 시 원본 페이지 안에서 video를 떠다니는 미니창으로
  //   PIP API(제스처 필요)와 달리 DOM 이동이라 "완전 자동" 가능. 모든 브라우저 동작.
  //   원위치엔 같은 크기 spacer를 남겨 레이아웃 보존 + 재진입 감지(spacer가 다시 보이면 복원).
  // ─────────────────────────────────────────────────────────────
  const MiniPlayer = (function () {
    let host, shadow, wrap, slot, subsEl, ov, playC, played, timeEl, current = null; // {video, origin, raf, vL, io}
    let dragging = false;

    const MINI_CSS = `
      :host{all:initial;}
      .mwrap{position:fixed;z-index:2147483646;width:480px;height:270px;
        background:#000;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.55);
        font-family:'Malgun Gothic',system-ui,-apple-system,sans-serif;color:#e9eef5;
        opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;}
      .mwrap.show{opacity:1;transform:none;}
      .mwrap.dragging{transition:none;cursor:grabbing;}
      .mslot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;}
      .vpip-video{position:static!important;width:100%!important;height:100%!important;max-width:none!important;
        max-height:none!important;inset:auto!important;left:auto!important;top:auto!important;right:auto!important;
        bottom:auto!important;margin:0!important;}
      .mov{position:absolute;inset:0;opacity:0;transition:opacity .14s;pointer-events:none;}
      .mwrap:hover .mov,.mwrap.paused .mov{opacity:1;pointer-events:auto;}
      .mtop{position:absolute;top:0;left:0;right:0;height:30px;display:flex;align-items:center;gap:2px;padding:0 5px;
        background:linear-gradient(180deg,rgba(0,0,0,.7),transparent);cursor:grab;}
      .mttl{flex:1;font-size:10px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85;padding-left:3px;}
      .mb{width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:#e9eef5;font-size:13px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;line-height:1;flex:none;}
      .mb:hover{background:rgba(255,255,255,.16);color:#4f9dff;}
      .mb.x:hover{color:#ff5b5b;}
      .mb.up:hover{color:#3ddc84;}
      .mcenter{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}
      .mplay{pointer-events:auto;width:48px;height:48px;border:none;border-radius:50%;background:rgba(20,24,32,.5);
        color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
      .mplay:hover{background:rgba(79,157,255,.85);}
      .mbot{position:absolute;left:0;right:0;bottom:0;padding:0 9px 7px;background:linear-gradient(0deg,rgba(0,0,0,.72),transparent);}
      .mseek{position:relative;height:14px;display:flex;align-items:center;cursor:pointer;}
      .mtrack{position:relative;height:3px;width:100%;border-radius:3px;background:rgba(255,255,255,.22);}
      .mseek:hover .mtrack{height:5px;}
      .mplayed{position:absolute;left:0;top:0;height:100%;background:#4f9dff;width:0;border-radius:3px;}
      .mtime{font-size:10px;color:#cfd8e3;padding:1px 0 0;}
      .msubs{position:absolute;left:50%;bottom:15%;transform:translateX(-50%);max-width:92%;text-align:center;color:#fff;
        font-weight:600;line-height:1.3;text-shadow:0 1px 3px rgba(0,0,0,.95);white-space:pre-wrap;pointer-events:none;font-size:12px;visibility:hidden;}
      .msubs.top{bottom:auto;top:9%;}
      button:focus-visible{outline:2px solid #4f9dff;outline-offset:1px;}
    `;

    function ensure() {
      if (host) return;
      host = document.createElement('div');
      host.id = '__video_pip_mini_host';
      shadow = host.attachShadow({ mode: 'open' });
      const st = document.createElement('style'); st.textContent = MINI_CSS; shadow.appendChild(st);

      const d = document;
      slot = el(d, 'div', { class: 'mslot' });
      subsEl = el(d, 'div', { class: 'msubs' });

      const ttl = el(d, 'span', { class: 'mttl', text: document.title || location.hostname });
      const upBtn = el(d, 'button', { class: 'mb up', title: '진짜 PIP 창으로 (원본 화질·풀 컨트롤)', 'aria-label': 'PIP로 전환', text: '⤢' });
      const homeBtn = el(d, 'button', { class: 'mb', title: '원래 위치로 돌아가기', 'aria-label': '원위치 복귀', text: '🏠' });
      const closeBtn = el(d, 'button', { class: 'mb x', title: '닫기', 'aria-label': '닫기', text: '✕' });
      const top = el(d, 'div', { class: 'mtop' }, [ttl, upBtn, homeBtn, closeBtn]);

      playC = el(d, 'button', { class: 'mplay', title: '재생/일시정지', 'aria-label': '재생/일시정지', text: '⏸' });
      const center = el(d, 'div', { class: 'mcenter' }, [playC]);

      played = el(d, 'div', { class: 'mplayed' });
      const track = el(d, 'div', { class: 'mtrack' }, [played]);
      const seek = el(d, 'div', { class: 'mseek' }, [track]);
      timeEl = el(d, 'span', { class: 'mtime', text: '0:00 / 0:00' });
      const bot = el(d, 'div', { class: 'mbot' }, [seek, timeEl]);

      ov = el(d, 'div', { class: 'mov' }, [top, center, bot]);
      wrap = el(d, 'div', { class: 'mwrap' }, [slot, subsEl, ov]);
      shadow.appendChild(wrap);
      (document.body || document.documentElement).appendChild(host);

      // 컨트롤 이벤트
      const togglePlay = () => { const v = current && current.video; if (!v) return; v.paused ? v.play() : v.pause(); };
      playC.addEventListener('click', togglePlay);
      upBtn.addEventListener('click', () => { const v = current && current.video; if (v) PipController.enter(v); }); // 클릭=제스처 → Document PiP 승격
      homeBtn.addEventListener('click', () => { // 원래 위치로 스크롤(안 그러면 자동PIP가 즉시 미니 재생성)
        const sp = current && current.origin && current.origin.spacer;
        if (sp && sp.scrollIntoView) { try { sp.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} }
        exit();
      });
      closeBtn.addEventListener('click', () => { const v = current && current.video; exit(); if (v) try { v.pause(); } catch (e) {} });
      seek.addEventListener('pointerdown', (e) => {
        const v = current && current.video; if (!v || !isFinite(v.duration)) return;
        const r = track.getBoundingClientRect();
        v.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * v.duration;
      });
      makeDraggable(top);
    }

    function applyCorner() {
      const c = ConfigManager.get().miniCorner;
      wrap.style.top = wrap.style.bottom = wrap.style.left = wrap.style.right = 'auto';
      const m = 18;
      if (c[0] === 't') wrap.style.top = m + 'px'; else wrap.style.bottom = m + 'px';
      if (c[1] === 'l') wrap.style.left = m + 'px'; else wrap.style.right = m + 'px';
    }

    function makeDraggable(handle) {
      let sx, sy, ox, oy;
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true; wrap.classList.add('dragging');
        const r = wrap.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        wrap.style.top = oy + 'px'; wrap.style.left = ox + 'px'; wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
        try { handle.setPointerCapture(e.pointerId); } catch (er) {}
      });
      handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        wrap.style.left = clamp(ox + e.clientX - sx, 0, innerWidth - wrap.offsetWidth) + 'px';
        wrap.style.top = clamp(oy + e.clientY - sy, 0, innerHeight - wrap.offsetHeight) + 'px';
      });
      const end = () => {
        if (!dragging) return;
        dragging = false; wrap.classList.remove('dragging');
        // 가장 가까운 코너로 스냅 + 저장
        const r = wrap.getBoundingClientRect();
        const corner = (r.top + r.height / 2 < innerHeight / 2 ? 't' : 'b') + (r.left + r.width / 2 < innerWidth / 2 ? 'l' : 'r');
        ConfigManager.set({ miniCorner: corner });
        applyCorner();
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    }

    function isActive() { return !!current; }
    function getVideo() { return current ? current.video : null; }

    function enter(video) {
      if (current || PipController.isActive()) return;
      video = video || VideoObserver.pickActive();
      if (!video || !video.parentNode) return;
      ensure();
      const cfg = ConfigManager.get();

      // 원위치 보존: 같은 크기 spacer를 끼워 레이아웃 유지 + 재진입 감지 타깃
      const rect = video.getBoundingClientRect();
      const spacer = document.createElement('div');
      spacer.setAttribute('data-vpip-mini-spacer', '1');
      spacer.style.cssText = 'width:' + Math.round(rect.width) + 'px;height:' + Math.round(rect.height) + 'px;';
      video.parentNode.insertBefore(spacer, video);
      const origin = { spacer, parent: video.parentNode, styleSnap: video.getAttribute('style') };

      video.classList.add('vpip-video');
      slot.appendChild(video); // ★ 원본 video를 미니창으로 이동(같은 document → 재생 유지)
      try { video.preservesPitch = cfg.preservePitch; } catch (e) {}
      FilterEngine.apply(video, cfg);
      SubtitleEngine.start(video, subsEl, cfg);
      subsEl.classList.toggle('top', cfg.subtitles.position === 'top');

      current = { video, origin, raf: null, vL: [] };
      applyCorner();
      requestAnimationFrame(() => wrap.classList.add('show'));

      const onV = (t, fn) => { video.addEventListener(t, fn); current.vL.push([t, fn]); };
      const syncPlay = () => { const p = video.paused; playC.textContent = p ? '▶' : '⏸'; wrap.classList.toggle('paused', p); };
      onV('play', syncPlay); onV('pause', syncPlay); syncPlay();

      function tick() {
        if (!current) return;
        const dur = video.duration;
        if (isFinite(dur) && dur > 0) {
          played.style.width = (video.currentTime / dur * 100) + '%';
          timeEl.textContent = fmtTime(video.currentTime) + ' / ' + fmtTime(dur);
        } else { played.style.width = '100%'; timeEl.textContent = '● LIVE'; }
        current.raf = requestAnimationFrame(tick);
      }
      current.raf = requestAnimationFrame(tick);

      // 재진입 감지: spacer(원위치)가 다시 화면에 들어오면 자동 복원
      try {
        current.io = new IntersectionObserver((entries) => {
          if (current && entries[0] && entries[0].intersectionRatio > 0.35) exit();
        }, { threshold: [0, 0.35] });
        current.io.observe(spacer);
      } catch (e) {}

      Toast.show('📺 미니플레이어로 따라갑니다 · ⤢ 누르면 고화질 PIP로');
    }

    function exit() {
      if (!current) return;
      const { video, origin, raf, vL, io } = current;
      current = null;
      if (raf) cancelAnimationFrame(raf);
      if (io) try { io.disconnect(); } catch (e) {}
      SubtitleEngine.stop();
      if (vL) vL.forEach(([t, fn]) => { try { video.removeEventListener(t, fn); } catch (e) {} });
      if (wrap) wrap.classList.remove('show', 'paused');
      try {
        video.classList.remove('vpip-video');
        FilterEngine.clear(video);
        if (origin.spacer && origin.spacer.parentNode) {
          origin.spacer.parentNode.insertBefore(video, origin.spacer);
          origin.spacer.remove();
        } else if (origin.parent && origin.parent.isConnected) {
          origin.parent.appendChild(video);
        }
        if (origin.styleSnap == null) video.removeAttribute('style');
        else video.setAttribute('style', origin.styleSnap);
      } catch (e) { console.warn('[PIP] 미니 복원 오류:', e); }
    }

    function restyle(cfg) { if (current) { FilterEngine.apply(current.video, cfg); subsEl.classList.toggle('top', cfg.subtitles.position === 'top'); } }

    return { enter, exit, isActive, getVideo, restyle };
  })();

  // ─────────────────────────────────────────────────────────────
  // HotkeyManager — 단축키
  // ─────────────────────────────────────────────────────────────
  const HotkeyManager = (function () {
    function combo(e) {
      const p = [];
      if (e.ctrlKey) p.push('Ctrl');
      if (e.altKey) p.push('Alt');
      if (e.shiftKey && e.key.length === 1) p.push('Shift');
      let k = e.key;
      if (k === ' ') k = 'Space';
      if (k.length === 1) k = k.toLowerCase();
      p.push(k);
      return p.join('+');
    }
    function keymap() {
      const hk = ConfigManager.get().hotkeys;
      const m = {};
      m[hk.togglePip] = 'togglePip';
      m['Space'] = 'playPause'; m['k'] = 'playPause';
      m['ArrowLeft'] = 'back'; m['ArrowRight'] = 'fwd';
      m['j'] = 'back10'; m['l'] = 'fwd10';
      m['ArrowUp'] = 'volUp'; m['ArrowDown'] = 'volDown'; m['m'] = 'mute';
      m[hk.speedDown] = 'speedDown'; m[hk.speedUp] = 'speedUp'; m['='] = 'speedReset';
      m[hk.screenshot] = 'screenshot'; m['r'] = 'rotate'; m['f'] = 'sizeToggle';
      return m;
    }
    function run(action) {
      const v = PipController.getVideo() || MiniPlayer.getVideo() || VideoObserver.pickActive();
      const cfg = ConfigManager.get();
      switch (action) {
        case 'togglePip': PipController.toggle(); return;
        case 'playPause': if (v) v.paused ? v.play() : v.pause(); break;
        case 'back': if (v) v.currentTime = Math.max(0, v.currentTime - cfg.seekStep); break;
        case 'fwd': if (v) v.currentTime += cfg.seekStep; break;
        case 'back10': if (v) v.currentTime = Math.max(0, v.currentTime - 10); break;
        case 'fwd10': if (v) v.currentTime += 10; break;
        case 'volUp': if (v) { v.volume = clamp(v.volume + 0.05, 0, 1); v.muted = false; } break;
        case 'volDown': if (v) { v.volume = clamp(v.volume - 0.05, 0, 1); } break;
        case 'mute': if (v) v.muted = !v.muted; break;
        case 'speedUp': if (v) PipController.nudgeRate(v, 0.1); break;
        case 'speedDown': if (v) PipController.nudgeRate(v, -0.1); break;
        case 'speedReset': if (v) { v.playbackRate = 1; ConfigManager.set({ defaultRate: 1 }); } break;
        case 'screenshot': if (v) PipController.screenshot(v); break;
        case 'rotate': ConfigManager.set({ rotate: (cfg.rotate + 90) % 360 }); FilterEngine.apply(v, ConfigManager.get()); break;
        case 'sizeToggle': { const big = cfg.pipSize.w < 700; const nw = big ? 900 : 480, nh = big ? 506 : 270; ConfigManager.set({ pipSize: { w: nw, h: nh } }); PipController.tryResize(nw, nh); break; }
      }
    }
    function handle(e) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const action = keymap()[combo(e)];
      if (!action) return;
      // PIP/미니 비활성 시엔 togglePip만 동작(사이트 단축키 보존)
      if (action !== 'togglePip' && !PipController.isActive() && !MiniPlayer.isActive()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      run(action);
    }
    function attach(doc) { doc.addEventListener('keydown', handle, { capture: true }); }
    return { attach };
  })();

  // ─────────────────────────────────────────────────────────────
  // AutoPipManager — 탭 전환 / 뷰포트 이탈 시 자동 PIP
  // ─────────────────────────────────────────────────────────────
  const AutoPipManager = (function () {
    let io = null;

    // 스크롤 이탈 → 미니플레이어(완전 자동, 제스처 불필요)
    function watch(video) {
      if (io) { io.disconnect(); io = null; }
      if (!video) return;
      io = new IntersectionObserver((entries) => {
        const e = entries[0];
        const cfg = ConfigManager.get();
        if (!cfg.autoPip) return;
        if (PipController.isActive() || MiniPlayer.isActive()) return; // 이미 PIP/미니면 무시
        if (e.intersectionRatio === 0 && !video.paused && !video.ended) {
          MiniPlayer.enter(video);
        }
      }, { threshold: [0] });
      io.observe(video);
    }

    // 탭 전환 → MediaSession 자동 PIP(Chrome이 제스처 없이 OS PIP를 띄워줌)
    function setupMediaSession() {
      if (!('mediaSession' in navigator) || !navigator.mediaSession.setActionHandler) return;
      try {
        navigator.mediaSession.setActionHandler('enterpictureinpicture', () => {
          const cfg = ConfigManager.get();
          const v = PipController.getVideo() || MiniPlayer.getVideo() || VideoObserver.pickActive();
          if (!cfg.autoPip || !v || PipController.isActive()) return;
          // 자동 진입은 제스처가 없어 Document PiP가 불가 → 네이티브 PIP 사용
          if (document.pictureInPictureEnabled && !v.disablePictureInPicture && !document.pictureInPictureElement) {
            v.requestPictureInPicture().catch(() => {});
          }
        });
      } catch (e) { /* 일부 브라우저 미지원 */ }
    }

    function start() {
      setupMediaSession();
      // 자동 진입한 PIP도 수동 PIP처럼 "사용자가 직접 닫을 때까지 유지"한다.
      //  (이전 1.2.2~1.2.3은 탭 복귀 시 자동으로 닫았는데, 다른 탭을 닫아 유튜브로
      //   돌아오면 자동 PIP가 사라지는 문제가 있어 복귀 자동 닫기를 제거함.)
    }
    return { start, watch };
  })();

  // ─────────────────────────────────────────────────────────────
  // Toast — 안내 / 클릭 우회
  // ─────────────────────────────────────────────────────────────
  const Toast = (function () {
    let host, shadow, box;
    function ensure() {
      if (host) return;
      host = document.createElement('div');
      shadow = host.attachShadow({ mode: 'open' });
      const st = document.createElement('style');
      st.textContent = `
        :host{all:initial;}
        .t{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483647;
          background:rgba(22,26,34,.95);backdrop-filter:blur(12px);color:#e9eef5;font-family:'Malgun Gothic',system-ui,sans-serif;
          border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:10px 18px;font-size:13px;font-weight:600;
          box-shadow:0 10px 30px rgba(0,0,0,.45);cursor:default;opacity:0;transition:opacity .2s;white-space:nowrap;}
        .t.show{opacity:1;} .t.click{cursor:pointer;border-color:#4f9dff;}
      `;
      shadow.appendChild(st);
      box = document.createElement('div'); box.className = 't';
      shadow.appendChild(box);
      (document.body || document.documentElement).appendChild(host);
    }
    let timer = null;
    function show(msg, onClick) {
      ensure();
      box.textContent = msg;
      box.classList.toggle('click', !!onClick);
      box.onclick = onClick ? () => { hide(); onClick(); } : null;
      box.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(hide, onClick ? 6000 : 3200);
    }
    function hide() { if (box) box.classList.remove('show'); }
    return { show };
  })();

  // ─────────────────────────────────────────────────────────────
  // UIManager — 원본 페이지 플로팅 패널
  // ─────────────────────────────────────────────────────────────
  const UIManager = (function () {
    let host, shadow, wrap, panel, pill, els = {}, idleTimer = null;

    const CSS = `
      :host{all:initial;}
      .wrap{position:fixed;z-index:2147483647;top:80px;right:24px;
        font-family:'Malgun Gothic',-apple-system,system-ui,sans-serif;color:#e9eef5;user-select:none;transition:opacity .25s ease;}
      .wrap.idle{opacity:.32;}
      .panel{width:256px;padding:14px;background:rgba(22,26,34,.92);backdrop-filter:blur(12px);
        border:1px solid rgba(255,255,255,.08);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.45);}
      .panel.hidden{display:none;}
      .head{display:flex;align-items:center;gap:6px;margin-bottom:12px;cursor:move;}
      .title{font-size:13px;font-weight:700;flex:1;}
      .badge{font-size:9px;font-weight:800;padding:2px 5px;border-radius:5px;background:#4f9dff;color:#fff;letter-spacing:.5px;}
      .iconbtn{width:26px;height:26px;border:none;border-radius:7px;cursor:pointer;background:rgba(255,255,255,.08);color:#e9eef5;font-size:13px;line-height:1;}
      .iconbtn:hover{background:rgba(255,255,255,.16);}
      .pipbtn{width:100%;height:44px;border:none;border-radius:10px;cursor:pointer;background:#4f9dff;color:#fff;
        font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;}
      .pipbtn:hover{filter:brightness(1.08);}
      .pipbtn.on{background:rgba(61,220,132,.16);}
      .pipbtn .dot{display:none;}
      .pipbtn.on .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#3ddc84;}
      .toggle{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;}
      .toggle .lbl{flex:1;}
      .sw{width:40px;height:22px;border-radius:999px;background:rgba(255,255,255,.18);position:relative;cursor:pointer;transition:background .15s;}
      .sw::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s;}
      .sw.on{background:#3ddc84;} .sw.on::after{left:20px;}
      .seclabel{font-size:11px;opacity:.55;margin:14px 0 7px;}
      .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;}
      .pbtn{padding:9px 0;border:none;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.08);color:#e9eef5;font-size:11px;font-weight:600;}
      .pbtn:hover{background:rgba(255,255,255,.16);}
      .pbtn.active{outline:2px solid #4f9dff;}
      details{margin-top:12px;border-top:1px solid rgba(255,255,255,.07);padding-top:8px;}
      summary{cursor:pointer;font-size:12px;font-weight:600;list-style:none;padding:4px 0;}
      summary::-webkit-details-marker{display:none;}
      summary::before{content:'▸ ';opacity:.6;}
      details[open]>summary::before{content:'▾ ';}
      .grp{margin:6px 0 2px;}
      .grp>summary{font-size:11px;opacity:.8;}
      .ctl{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:11px;}
      .ctl .cl{width:34px;opacity:.7;}
      .ctl .cv{width:40px;text-align:right;color:#4f9dff;font-weight:700;}
      .ctl input[type=range]{-webkit-appearance:none;appearance:none;flex:1;height:4px;border-radius:4px;background:rgba(255,255,255,.16);outline:none;}
      .ctl input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#4f9dff;cursor:pointer;}
      .btnrow{display:flex;gap:5px;margin:6px 0;}
      .minibtn{flex:1;padding:6px 0;border:none;border-radius:7px;background:rgba(255,255,255,.08);color:#e9eef5;font-size:11px;cursor:pointer;}
      .minibtn:hover{background:rgba(255,255,255,.16);} .minibtn.active{background:#4f9dff;color:#fff;}
      .resetb{width:100%;margin-top:4px;padding:6px 0;border:none;border-radius:7px;background:rgba(255,255,255,.05);color:#e9eef5;font-size:11px;cursor:pointer;opacity:.85;}
      .keys{font-size:11px;line-height:1.7;opacity:.8;}
      .keys b{display:inline-block;min-width:64px;color:#4f9dff;}
      .note{font-size:10px;opacity:.55;margin-top:6px;line-height:1.4;}
      button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #4f9dff;outline-offset:2px;}
      .vsel{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;}
      .vsel .vb{padding:4px 9px;border:none;border-radius:7px;background:rgba(255,255,255,.08);color:#e9eef5;font-size:11px;cursor:pointer;}
      .vsel .vb.active{background:#4f9dff;color:#fff;}
      .pill{display:none;align-items:center;gap:6px;cursor:pointer;padding:8px 13px;background:rgba(22,26,34,.92);
        backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.08);border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.4);font-size:13px;font-weight:700;}
      .pill.show{display:inline-flex;} .pill .pdot{width:8px;height:8px;border-radius:50%;background:#888;} .pill.on .pdot{background:#3ddc84;}
      .tip{position:absolute;top:0;right:278px;width:190px;padding:12px;background:#4f9dff;color:#fff;border-radius:10px;
        font-size:12px;line-height:1.5;box-shadow:0 6px 18px rgba(0,0,0,.4);}
      .tip::after{content:'';position:absolute;top:18px;right:-6px;border:6px solid transparent;border-left-color:#4f9dff;}
      .tip button{display:block;margin-top:8px;background:rgba(255,255,255,.25);border:none;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;}
    `;

    function build() {
      const cfg = ConfigManager.get();
      host = document.createElement('div');
      host.id = '__video_pip_host';
      shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = CSS; shadow.appendChild(style);

      const d = document;
      // 헤더
      const title = el(d, 'span', { class: 'title', text: '🎬 고화질 PIP' });
      const badge = el(d, 'span', { class: 'badge', text: SUPPORTS_DOC_PIP ? 'HD' : 'BASIC' });
      const collapseBtn = el(d, 'button', { class: 'iconbtn', title: '접기', text: '—' });
      const head = el(d, 'div', { class: 'head' }, [title, badge, collapseBtn]);

      // 1존: PIP 켜기 + 자동
      const pipDot = el(d, 'span', { class: 'dot' });
      const pipLabel = el(d, 'span', { text: 'PIP 켜기' });
      const pipBtn = el(d, 'button', { class: 'pipbtn' }, [pipDot, el(d, 'span', { text: '📺' }), pipLabel]);
      const autoSw = el(d, 'div', { class: 'sw' + (cfg.autoPip ? ' on' : '') });
      const autoRow = el(d, 'div', { class: 'toggle' }, [el(d, 'span', { class: 'lbl', text: '🤖 자동 PIP (스크롤=미니 · 탭전환=PIP)' }), autoSw]);

      // 2존: 프리셋
      const presetGrid = el(d, 'div', { class: 'grid' });
      const presetBtns = {};
      PRESET_KEYS.forEach((k) => {
        const p = PRESETS[k];
        const spec = `${p.size.w}×${p.size.h} · ${p.rate}x` + (k === 'night' ? ' · 야간보정' : '');
        const b = el(d, 'button', { class: 'pbtn' + (cfg.activePreset === k ? ' active' : ''), title: p.label + ' — ' + spec, 'aria-label': p.label + ' ' + spec, text: p.label });
        presetBtns[k] = b; presetGrid.appendChild(b);
      });

      // 멀티 영상 셀렉터(조건부)
      const vselWrap = el(d, 'div', { class: 'vsel' });
      const vselSec = el(d, 'div', {}, [el(d, 'div', { class: 'seclabel', text: '대상 영상' }), vselWrap]);
      vselSec.style.display = 'none';

      // 3존: 고급 설정
      const advanced = buildAdvanced(d, cfg);

      panel = el(d, 'div', { class: 'panel' + (cfg.collapsed ? ' hidden' : '') }, [
        head, pipBtn, autoRow,
        el(d, 'div', { class: 'seclabel', text: '상황별 프리셋' }), presetGrid,
        vselSec, advanced.root,
      ]);

      // 접힌 핀
      const pdot = el(d, 'span', { class: 'pdot' });
      pill = el(d, 'div', { class: 'pill' + (cfg.collapsed ? ' show' : '') }, [pdot, el(d, 'span', { text: '🎬 PIP' })]);

      wrap = el(d, 'div', { class: 'wrap' }, [panel, pill]);
      shadow.appendChild(wrap);

      els = { pipBtn, pipLabel, pipDot, autoSw, presetBtns, pill, pdot, head, vselWrap, vselSec, advanced };

      bindEvents();
      mountToFullscreenOrBody();
      startIdleFade();
      maybeOnboard();
      refreshState(PipController.isActive());
    }

    function buildAdvanced(d, cfg) {
      const f = cfg.filters;
      const liveVideo = () => PipController.getVideo() || MiniPlayer.getVideo();
      const apply = () => FilterEngine.apply(liveVideo(), ConfigManager.get());
      const setSub = (patch) => { ConfigManager.set({ subtitles: Object.assign({}, ConfigManager.get().subtitles, patch) }); SubtitleEngine.restyle(ConfigManager.get()); };

      // 재생
      const rateCtl = slider(d, '배속', MIN_RATE, MAX_RATE, 0.05, cfg.defaultRate, (v) => v.toFixed(2) + 'x', (v) => {
        ConfigManager.set({ defaultRate: v }); const vid = liveVideo(); if (vid) vid.playbackRate = v;
      });
      const grpPlay = group(d, '🔄 재생', [rateCtl.root]);

      // 화면
      const zoomCtl = slider(d, '줌', 1, 3, 0.05, cfg.zoom, (v) => v.toFixed(2) + 'x', (v) => { ConfigManager.set({ zoom: v }); apply(); });
      const dimCtl = slider(d, '디밍', 50, 100, 1, cfg.dim, (v) => v + '%', (v) => { ConfigManager.set({ dim: v }); apply(); });
      const rotBtns = btnRow(d, ['0°', '90°', '180°', '270°'], [0, 90, 180, 270], cfg.rotate, (v) => { ConfigManager.set({ rotate: v }); apply(); });
      const fitBtns = btnRow(d, ['맞춤', '채움'], ['contain', 'cover'], cfg.fit, (v) => { ConfigManager.set({ fit: v }); apply(); });
      const screenReset = el(d, 'button', { class: 'resetb', text: '↺ 화면 초기화' });
      screenReset.addEventListener('click', () => { ConfigManager.set({ zoom: 1, rotate: 0, mirror: false, fit: 'contain', dim: 100 }); zoomCtl.set(1); dimCtl.set(100); rotBtns.set(0); fitBtns.set('contain'); apply(); });
      const grpScreen = group(d, '🖼️ 화면', [zoomCtl.root, dimCtl.root, el(d, 'div', { class: 'ctl' }, [el(d, 'span', { class: 'cl', text: '회전' }), rotBtns.root]), el(d, 'div', { class: 'ctl' }, [el(d, 'span', { class: 'cl', text: '채움' }), fitBtns.root]), screenReset]);

      // 필터
      const briCtl = slider(d, '밝기', 50, 150, 1, f.brightness, (v) => v + '%', (v) => { ConfigManager.setFilters({ brightness: v }); apply(); });
      const conCtl = slider(d, '대비', 50, 150, 1, f.contrast, (v) => v + '%', (v) => { ConfigManager.setFilters({ contrast: v }); apply(); });
      const satCtl = slider(d, '채도', 0, 200, 1, f.saturate, (v) => v + '%', (v) => { ConfigManager.setFilters({ saturate: v }); apply(); });
      const nightBtn = el(d, 'button', { class: 'minibtn', text: '🌙 야간 보정' });
      nightBtn.addEventListener('click', () => { ConfigManager.setFilters({ brightness: 115, contrast: 110, saturate: 100 }); briCtl.set(115); conCtl.set(110); satCtl.set(100); apply(); });
      const filterReset = el(d, 'button', { class: 'resetb', text: '↺ 필터 초기화' });
      filterReset.addEventListener('click', () => { ConfigManager.setFilters({ brightness: 100, contrast: 100, saturate: 100 }); briCtl.set(100); conCtl.set(100); satCtl.set(100); apply(); });
      const grpFilter = group(d, '🎨 필터', [briCtl.root, conCtl.root, satCtl.root, el(d, 'div', { class: 'btnrow' }, [nightBtn]), filterReset]);

      // 자막 따라오기
      const s = cfg.subtitles;
      const subOnBtns = btnRow(d, ['표시', '숨김'], [true, false], s.enabled, (v) => setSub({ enabled: v }));
      const subSizeCtl = slider(d, '크기', 50, 200, 5, s.size, (v) => v + '%', (v) => setSub({ size: v }));
      const subPosBtns = btnRow(d, ['하단', '상단'], ['bottom', 'top'], s.position, (v) => setSub({ position: v }));
      const subBgCtl = slider(d, '배경', 0, 100, 5, s.bg, (v) => v + '%', (v) => setSub({ bg: v }));
      const grpSub = group(d, '💬 자막', [
        el(d, 'div', { class: 'ctl' }, [el(d, 'span', { class: 'cl', text: '표시' }), subOnBtns.root]),
        subSizeCtl.root,
        el(d, 'div', { class: 'ctl' }, [el(d, 'span', { class: 'cl', text: '위치' }), subPosBtns.root]),
        subBgCtl.root,
        el(d, 'div', { class: 'note', text: '※ 사이트 자막(유튜브 CC 등)을 켜두면 PIP 창으로 따라옵니다.' }),
      ]);

      // 슬립 타이머
      const sleepBtns = btnRow(d, ['끄기', '15분', '30분', '60분', '영상끝'], ['off', '15', '30', '60', 'end'], SleepTimer.mode, (v) => SleepTimer.set(v));
      const grpSleep = group(d, '💤 슬립 타이머', [sleepBtns.root, el(d, 'div', { class: 'note', text: '※ PIP가 켜져 있어야 동작합니다.' })]);

      // 단축키(읽기 전용) — innerHTML 대신 DOM 구성(유튜브 Trusted Types 대응)
      const keyData = [
        ['Alt+P', 'PIP 켜기/끄기'], ['Space / K', '재생·일시정지'], ['← / →', '5초 이동'],
        ['J / L', '10초 이동'], ['↑ / ↓', '볼륨'], ['M', '음소거'], ['[ / ] / =', '배속 −/＋ · 리셋'],
        ['R / F / S', '회전 · 크기 · 스크린샷'], ['Esc', '닫기'],
      ];
      const keys = el(d, 'div', { class: 'keys' });
      keyData.forEach(([k, desc]) => keys.appendChild(
        el(d, 'div', {}, [el(d, 'b', { text: k }), el(d, 'span', { text: ' ' + desc })])));
      const grpKeys = group(d, '⌨️ 단축키', [keys]);

      // 전체 초기화(이 사이트)
      const allReset = el(d, 'button', { class: 'resetb', text: '↺ 모든 설정 초기화 (이 사이트)' });
      allReset.addEventListener('click', () => {
        ConfigManager.reset();
        const v = PipController.getVideo();
        if (v) { v.playbackRate = ConfigManager.get().defaultRate; FilterEngine.apply(v, ConfigManager.get()); }
        SubtitleEngine.restyle(ConfigManager.get());
        if (host) host.remove();
        build();
      });

      const root = el(d, 'details', {}, [el(d, 'summary', { text: '⚙️ 고급 설정' }), grpPlay, grpScreen, grpFilter, grpSub, grpSleep, grpKeys, allReset]);
      return { root, set(c) {
        rateCtl.set(c.defaultRate); zoomCtl.set(c.zoom); dimCtl.set(c.dim); rotBtns.set(c.rotate); fitBtns.set(c.fit);
        briCtl.set(c.filters.brightness); conCtl.set(c.filters.contrast); satCtl.set(c.filters.saturate);
        subOnBtns.set(c.subtitles.enabled); subSizeCtl.set(c.subtitles.size); subPosBtns.set(c.subtitles.position); subBgCtl.set(c.subtitles.bg);
      } };
    }

    function group(d, label, children) {
      return el(d, 'details', { class: 'grp', open: '' }, [el(d, 'summary', { text: label }), ...children.map((c) => c)]);
    }
    function slider(d, label, min, max, step, val, fmt, onInput) {
      const cl = el(d, 'span', { class: 'cl', text: label });
      const input = el(d, 'input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val) });
      const cv = el(d, 'span', { class: 'cv', text: fmt(val) });
      input.addEventListener('input', () => { const v = parseFloat(input.value); cv.textContent = fmt(v); onInput(v); });
      const root = el(d, 'div', { class: 'ctl' }, [cl, input, cv]);
      return { root, set(v) { input.value = String(v); cv.textContent = fmt(v); } };
    }
    function btnRow(d, labels, values, active, onPick) {
      const btns = [];
      const root = el(d, 'div', { class: 'btnrow' });
      labels.forEach((lab, i) => {
        const b = el(d, 'button', { class: 'minibtn' + (values[i] === active ? ' active' : ''), text: lab });
        b.addEventListener('click', () => { btns.forEach((x) => x.classList.remove('active')); b.classList.add('active'); onPick(values[i]); });
        btns.push(b); root.appendChild(b);
      });
      return { root, set(v) { btns.forEach((b, i) => b.classList.toggle('active', values[i] === v)); } };
    }

    function bindEvents() {
      els.pipBtn.addEventListener('click', () => PipController.toggle());
      els.autoSw.addEventListener('click', () => {
        const next = !ConfigManager.get().autoPip;
        ConfigManager.set({ autoPip: next });
        els.autoSw.classList.toggle('on', next);
        if (next) {
          const v = VideoObserver.pickActive();
          Toast.show(v && !v.paused
            ? '🤖 자동 PIP 켜짐 — 스크롤로 영상이 사라지면 미니플레이어로 따라가고, 탭을 바꾸면 PIP로 떠요.'
            : '🤖 자동 PIP 켜짐 — 영상을 재생하면 스크롤 시 미니플레이어가 따라갑니다.');
        } else {
          MiniPlayer.exit();
        }
      });
      PRESET_KEYS.forEach((k) => els.presetBtns[k].addEventListener('click', () => applyPreset(k)));
      els.head.querySelector('.iconbtn').addEventListener('click', () => setCollapsed(true));
      els.pill.addEventListener('click', () => setCollapsed(false));
      makeDraggable(els.head, wrap);
    }

    function applyPreset(key) {
      const p = PRESETS[key];
      ConfigManager.set({ activePreset: key, defaultRate: p.rate, zoom: p.zoom, rotate: p.rotate, fit: p.fit, pipSize: { w: p.size.w, h: p.size.h } });
      ConfigManager.setFilters(p.filters);
      PRESET_KEYS.forEach((k) => els.presetBtns[k].classList.toggle('active', k === key));
      els.advanced.set(ConfigManager.get());
      const v = PipController.getVideo();
      if (PipController.isActive()) {
        if (v) { v.playbackRate = p.rate; FilterEngine.apply(v, ConfigManager.get()); }
        PipController.tryResize(p.size.w, p.size.h);
      } else {
        PipController.enter(); // 클릭 제스처로 진입
      }
    }

    function refreshState(active) {
      if (!els.pipBtn) return;
      els.pipBtn.classList.toggle('on', active);
      els.pipLabel.textContent = active ? 'PIP 끄기' : 'PIP 켜기';
      els.pill.classList.toggle('on', active);
      // 멀티 영상 셀렉터 갱신
      refreshVideoSelector();
    }

    function refreshVideoSelector() {
      if (!els.vselWrap) return;
      const vids = VideoObserver.list();
      if (vids.length < 2) { els.vselSec.style.display = 'none'; return; }
      els.vselSec.style.display = 'block';
      els.vselWrap.textContent = '';
      const cur = PipController.getVideo();
      vids.slice(0, 6).forEach((v, i) => {
        const b = el(document, 'button', { class: 'vb' + (v === cur ? ' active' : ''), text: '◉ ' + (i + 1) });
        b.addEventListener('click', () => { VideoObserver.setManual(v); refreshVideoSelector(); });
        els.vselWrap.appendChild(b);
      });
    }

    function setCollapsed(on) {
      ConfigManager.set({ collapsed: on });
      panel.classList.toggle('hidden', on);
      els.pill.classList.toggle('show', on);
    }

    function makeDraggable(handle, w) {
      let sx, sy, ox, oy, dragging = false;
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        const r = w.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        w.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
        w.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
        w.style.right = 'auto';
      });
      const end = () => { dragging = false; };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    }

    function startIdleFade() {
      const wake = () => {
        wrap.classList.remove('idle');
        clearTimeout(idleTimer);
        if (ConfigManager.get().fadeWhenIdle) idleTimer = setTimeout(() => wrap.classList.add('idle'), 3500);
      };
      ['pointermove', 'pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
      wake();
    }

    function mountToFullscreenOrBody() {
      const place = () => {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        const target = fs || document.body;
        if (host.parentElement !== target) target.appendChild(host);
      };
      place();
      document.addEventListener('fullscreenchange', place);
      document.addEventListener('webkitfullscreenchange', place);
    }

    function maybeOnboard() {
      if (ConfigManager.get().onboarded) return;
      const close = el(document, 'button', { text: '알겠어요' });
      const tip = el(document, 'div', { class: 'tip' }, [
        el(document, 'div', { text: '🎬 영상을 항상 위에 뜨는 작은 창으로 빼냅니다. 화질은 원본 그대로! 버튼을 누르거나 Alt+P 한 번이면 끝이에요.' }),
        close,
      ]);
      wrap.appendChild(tip);
      close.addEventListener('click', () => { tip.remove(); ConfigManager.set({ onboarded: true }); ConfigManager.saveNow(); });
    }

    return { build, refreshState, refreshVideoSelector };
  })();

  // ─────────────────────────────────────────────────────────────
  // 부트스트랩
  // ─────────────────────────────────────────────────────────────
  ConfigManager.load();
  HotkeyManager.attach(document);
  PipController.setOnStateChange((active) => UIManager.refreshState(active));

  VideoObserver.start((active) => {
    // 미니플레이어가 잡고 있던 video가 SPA 전환으로 죽었으면 닫기
    if (MiniPlayer.isActive()) { const mv = MiniPlayer.getVideo(); if (!mv || !mv.isConnected) MiniPlayer.exit(); }
    AutoPipManager.watch(active);
    PipController.onActiveVideoChanged(active);
    UIManager.refreshVideoSelector();
  });
  AutoPipManager.start();
  AutoPipManager.watch(VideoObserver.pickActive());

  let uiBuilt = false;
  function buildUIOnce() {
    if (uiBuilt) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', buildUIOnce, { once: true }); return; }
    uiBuilt = true;
    try { UIManager.build(); console.log('[PIP] UI 표시 완료 · Document PiP:', SUPPORTS_DOC_PIP); }
    catch (e) { uiBuilt = false; console.error('[PIP] UI 생성 실패:', e); }
  }

  console.log('[PIP] 스크립트 시작 · URL:', location.href);
  buildUIOnce();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUIOnce, { once: true });
  window.addEventListener('load', buildUIOnce, { once: true });
})();
