// ==UserScript==
// @name           🎬 고화질 영상 PIP (Picture-in-Picture)
// @name:en        HD Video Picture-in-Picture
// @namespace      https://github.com/goguma613/video-pip
// @version        2.0.1
// @description    영상을 원본 화질 그대로 항상 위에 뜨는 작은 창으로. 영상 위 ⧉ 버튼 또는 Alt+P 한 번이면 끝.
// @description:en Pop any video into an always-on-top window at original quality (Document Picture-in-Picture). Hover button or Alt+P.
// @author         goguma613
// @match          *://*/*
// @exclude        *://*.netflix.com/*
// @exclude        *://*.disneyplus.com/*
// @grant          none
// @run-at         document-start
// @updateURL      https://raw.githubusercontent.com/goguma613/video-pip/main/video-pip.user.js
// @downloadURL    https://raw.githubusercontent.com/goguma613/video-pip/main/video-pip.user.js
// @homepageURL    https://github.com/goguma613/video-pip
// @supportURL     https://github.com/goguma613/video-pip/issues
// @icon           data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234f9dff'%3E%3Cpath d='M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z'/%3E%3C/svg%3E
// ==/UserScript==

// 이 파일은 빌드 결과물입니다. 소스: https://github.com/goguma613/video-pip/tree/main/src

"use strict";
(() => {
  // src/util.ts
  var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h2 = Math.floor(sec / 3600);
    const m = Math.floor(sec % 3600 / 60);
    const s = String(sec % 60).padStart(2, "0");
    return h2 ? `${h2}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  }
  function debounce(fn, ms) {
    let timer;
    let last = null;
    const run = () => {
      clearTimeout(timer);
      timer = void 0;
      if (last) {
        const a = last;
        last = null;
        fn(...a);
      }
    };
    const d = ((...args) => {
      last = args;
      clearTimeout(timer);
      timer = setTimeout(run, ms);
    });
    d.flush = run;
    return d;
  }
  function warn(...args) {
    console.warn("[video-pip]", ...args);
  }
  function isTopFrame() {
    try {
      return window.top === window;
    } catch {
      return false;
    }
  }
  function pipWindowSize(v, longEdge) {
    const ar = v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 16 / 9;
    let w = ar >= 1 ? longEdge : longEdge * ar;
    let h2 = ar >= 1 ? longEdge / ar : longEdge;
    const k = Math.min(1, screen.availWidth * 0.9 / w, screen.availHeight * 0.9 / h2);
    return { width: Math.round(w * k), height: Math.round(h2 * k) };
  }

  // src/media.ts
  var RATE_CYCLE = [0.5, 1, 1.25, 1.5, 2];
  var RATE_MIN = 0.25;
  var RATE_MAX = 4;
  var isLive = (v) => v.duration === Infinity;
  function seekRange(v) {
    const s = v.seekable;
    if (s && s.length) {
      const start = s.start(0), end = s.end(s.length - 1);
      if (Number.isFinite(end) && end > start) return { start, end };
    }
    if (Number.isFinite(v.duration) && v.duration > 0) return { start: 0, end: v.duration };
    return null;
  }
  function togglePlay(v) {
    if (v.paused || v.ended) v.play()?.catch(() => {
    });
    else v.pause();
  }
  function seekBy(v, sec) {
    const r = seekRange(v);
    if (r) v.currentTime = clamp(v.currentTime + sec, r.start, r.end);
  }
  function seekToRatio(v, ratio) {
    const r = seekRange(v);
    if (r) v.currentTime = r.start + clamp(ratio, 0, 1) * (r.end - r.start);
  }
  function toLiveEdge(v) {
    const r = seekRange(v);
    if (r) v.currentTime = Math.max(r.start, r.end - 1);
  }
  function changeVolume(v, delta) {
    v.volume = clamp(Math.round((v.volume + delta) * 100) / 100, 0, 1);
    if (delta > 0) v.muted = false;
  }
  function toggleMute(v) {
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 0.5;
  }
  function cycleRate(v) {
    v.playbackRate = RATE_CYCLE.find((r) => r > v.playbackRate + 1e-3) ?? RATE_CYCLE[0];
  }
  function nudgeRate(v, delta) {
    v.playbackRate = clamp(Math.round((v.playbackRate + delta) * 100) / 100, RATE_MIN, RATE_MAX);
  }

  // src/commands.ts
  function buildCommands(session) {
    const on = (fn) => () => {
      const v = session.video();
      if (v) fn(v);
    };
    return [
      { id: "pip.toggle", label: "PIP 켜기/끄기", keys: ["Alt+KeyP"], scope: "global", run: () => void session.toggle() },
      { id: "close", label: "닫기", keys: ["Escape"], scope: "player", run: () => void session.close() },
      { id: "play", label: "재생/일시정지", keys: ["Space", "KeyK"], scope: "player", run: on(togglePlay) },
      { id: "back5", label: "5초 뒤로", keys: ["ArrowLeft"], scope: "player", repeat: true, run: on((v) => seekBy(v, -5)) },
      { id: "fwd5", label: "5초 앞으로", keys: ["ArrowRight"], scope: "player", repeat: true, run: on((v) => seekBy(v, 5)) },
      { id: "back10", label: "10초 뒤로", keys: ["KeyJ"], scope: "player", repeat: true, run: on((v) => seekBy(v, -10)) },
      { id: "fwd10", label: "10초 앞으로", keys: ["KeyL"], scope: "player", repeat: true, run: on((v) => seekBy(v, 10)) },
      { id: "volUp", label: "볼륨 올리기", keys: ["ArrowUp"], scope: "player", repeat: true, run: on((v) => changeVolume(v, 0.05)) },
      { id: "volDown", label: "볼륨 내리기", keys: ["ArrowDown"], scope: "player", repeat: true, run: on((v) => changeVolume(v, -0.05)) },
      { id: "mute", label: "음소거", keys: ["KeyM"], scope: "player", run: on(toggleMute) },
      { id: "rateDown", label: "배속 낮추기", keys: ["BracketLeft"], scope: "player", repeat: true, run: on((v) => nudgeRate(v, -0.25)) },
      { id: "rateUp", label: "배속 높이기", keys: ["BracketRight"], scope: "player", repeat: true, run: on((v) => nudgeRate(v, 0.25)) },
      { id: "rateReset", label: "배속 1배로", keys: ["Equal"], scope: "player", run: on((v) => {
        v.playbackRate = 1;
      }) },
      { id: "rateCycle", label: "배속 바꾸기", keys: [], scope: "player", run: on(cycleRate) }
    ];
  }
  function comboOf(e) {
    const parts = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    parts.push(e.code || e.key);
    return parts.join("+");
  }
  var LABELS = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    BracketLeft: "[",
    BracketRight: "]",
    Equal: "=",
    Escape: "Esc"
  };
  function keyLabel(combo) {
    return combo.split("+").map((p) => LABELS[p] ?? p.replace(/^(Key|Digit)/, "")).join("+");
  }
  var TEXT_INPUTS = /* @__PURE__ */ new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week"]);
  function isEditable(t) {
    const el = t;
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    return el.tagName === "INPUT" && TEXT_INPUTS.has(el.type);
  }
  function createKeymap(commands) {
    const byKey = /* @__PURE__ */ new Map();
    const byId = /* @__PURE__ */ new Map();
    for (const c of commands) {
      byId.set(c.id, c);
      for (const k of c.keys) byKey.set(k, c);
    }
    return {
      handle(e, scope) {
        if (e.isComposing || isEditable(e.composedPath?.()[0] ?? e.target)) return false;
        const c = byKey.get(comboOf(e));
        if (!c || scope === "global" && c.scope !== "global") return false;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat || c.repeat) c.run();
        return true;
      },
      run(id) {
        byId.get(id)?.run();
      },
      hint(id) {
        const c = byId.get(id);
        if (!c) return "";
        return c.keys.length ? `${c.label} (${c.keys.map(keyLabel).join(" / ")})` : c.label;
      }
    };
  }

  // src/config.ts
  var DEFAULTS = {
    schema: 2,
    pipLongEdge: 480,
    autoTabPip: false,
    launcher: true,
    disabledSites: [],
    hinted: false
  };
  var LONG_EDGE_MIN = 240;
  var LONG_EDGE_MAX = 1920;
  var KEY = "vpip:v2";
  var V1_KEY = "__videoPip_cfg";
  function sanitize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const bool = (v, d) => typeof v === "boolean" ? v : d;
    const num = (v, d) => typeof v === "number" && Number.isFinite(v) ? v : d;
    const sites = Array.isArray(r.disabledSites) ? r.disabledSites.filter((s) => typeof s === "string" && s.length > 0 && s.length < 256) : [];
    return {
      schema: 2,
      pipLongEdge: Math.round(clamp(num(r.pipLongEdge, DEFAULTS.pipLongEdge), LONG_EDGE_MIN, LONG_EDGE_MAX)),
      autoTabPip: bool(r.autoTabPip, DEFAULTS.autoTabPip),
      launcher: bool(r.launcher, DEFAULTS.launcher),
      disabledSites: [...new Set(sites)].slice(0, 500),
      hinted: bool(r.hinted, DEFAULTS.hinted)
    };
  }
  function migrateV1(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const out = {};
    const { w, h: h2 } = r.pipSize ?? {};
    if (typeof w === "number" && typeof h2 === "number") out.pipLongEdge = Math.max(w, h2);
    if (typeof r.autoPip === "boolean") out.autoTabPip = r.autoPip;
    if (typeof r.onboarded === "boolean") out.hinted = r.onboarded;
    return out;
  }
  function siteKey(hostname) {
    return hostname.toLowerCase().replace(/^(www|m)\./, "");
  }
  function gmBackend() {
    if (typeof GM_getValue !== "function" || typeof GM_setValue !== "function") return null;
    const get = GM_getValue, set = GM_setValue;
    return { read: () => get(KEY, null), write: (cfg) => set(KEY, cfg) };
  }
  function localBackend(storage) {
    let memory = null;
    return {
      read() {
        if (!storage) return memory;
        const s = storage.getItem(KEY);
        if (s == null) return null;
        try {
          return JSON.parse(s);
        } catch {
          return {};
        }
      },
      write(cfg) {
        memory = cfg;
        try {
          storage?.setItem(KEY, JSON.stringify(cfg));
        } catch (e) {
          warn("설정 저장 실패", e);
        }
      }
    };
  }
  function safeLocalStorage() {
    try {
      const s = window.localStorage;
      s.getItem(KEY);
      return s;
    } catch {
      return null;
    }
  }
  function createConfig(backend, host2, v1) {
    let raw = null;
    try {
      raw = backend.read();
    } catch (e) {
      warn("설정 읽기 실패", e);
    }
    let migrated = false;
    if (raw == null && v1) {
      try {
        const old = v1.getItem(V1_KEY);
        if (old) {
          raw = { ...DEFAULTS, ...migrateV1(JSON.parse(old)) };
          v1.removeItem(V1_KEY);
          migrated = true;
        }
      } catch (e) {
        warn("v1 설정 이관 실패", e);
      }
    }
    let cfg = sanitize(raw);
    const subs = /* @__PURE__ */ new Set();
    const save = debounce(() => backend.write(cfg), 300);
    if (migrated) backend.write(cfg);
    const set = (patch) => {
      cfg = sanitize({ ...cfg, ...patch });
      save();
      subs.forEach((fn) => {
        try {
          fn(cfg);
        } catch (e) {
          warn(e);
        }
      });
    };
    return {
      get: () => cfg,
      set,
      siteDisabled: () => cfg.disabledSites.includes(host2),
      setSiteDisabled(off) {
        const rest = cfg.disabledSites.filter((s) => s !== host2);
        set({ disabledSites: off ? [...rest, host2] : rest });
      },
      subscribe(fn) {
        subs.add(fn);
        return () => subs.delete(fn);
      },
      flush: () => save.flush()
    };
  }

  // src/styles/page.css
  var page_default = "/* 원본 페이지에 띄우는 것(⧉ 버튼, 알림). Shadow Root 안이라 사이트 CSS와 섞이지 않는다. */\n:host {\n  all: initial !important;\n  position: fixed !important; top: 0 !important; left: 0 !important;\n  width: 0 !important; height: 0 !important;\n  z-index: 2147483647 !important; pointer-events: none !important;\n}\n* { box-sizing: border-box; }\n.chip {\n  position: fixed; top: 0; right: 0; display: flex; align-items: center; gap: 0; height: 30px; padding: 0 7px;\n  border: 1px solid rgba(255, 255, 255, .2); border-radius: 15px; background: rgba(16, 19, 26, .78);\n  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: 0 2px 10px rgba(0, 0, 0, .35);\n  color: #fff; font: 600 12px/1 system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;\n  cursor: pointer; pointer-events: auto;\n  opacity: 0; visibility: hidden; transform: translateY(-4px);\n  transition: opacity .15s, transform .15s, visibility 0s linear .15s, background .15s;\n}\n.chip.show { opacity: 1; visibility: visible; transform: none; transition: opacity .15s, transform .15s, visibility 0s, background .15s; }\n.chip:hover, .chip:focus-visible { background: rgba(79, 157, 255, .95); gap: 6px; }\n.chip:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }\n.chip svg { display: block; width: 16px; height: 16px; flex: none; }\n.chip .lbl { max-width: 0; overflow: hidden; white-space: nowrap; transition: max-width .2s; }\n.chip:hover .lbl, .chip:focus-visible .lbl { max-width: 64px; }\n\n.toast {\n  position: fixed; left: 50%; bottom: 32px; max-width: min(520px, calc(100vw - 32px)); transform: translate(-50%, 8px);\n  padding: 10px 16px; border-radius: 12px; background: rgba(16, 19, 26, .94); border: 1px solid rgba(255, 255, 255, .12);\n  box-shadow: 0 10px 30px rgba(0, 0, 0, .45); color: #f1f4f8; text-align: center;\n  font: 600 13px/1.45 system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;\n  opacity: 0; transition: opacity .2s, transform .2s; pointer-events: none;\n}\n.toast.show { opacity: 1; transform: translate(-50%, 0); }\n@media (prefers-reduced-motion: reduce) { .chip, .chip .lbl, .toast { transition: none !important; } }\n";

  // src/dom.ts
  function h(doc, tag, attrs, ...children) {
    const el = doc.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === void 0 || v === false) continue;
        if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
        else if (k === "class") el.className = String(v);
        else if (k === "text") el.textContent = String(v);
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const c of children) if (c != null && c !== false) el.append(c);
    return el;
  }
  function adoptCss(root2, css) {
    const doc = root2.nodeType === 9 ? root2 : root2.ownerDocument;
    const win = doc.defaultView;
    try {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(css);
      root2.adoptedStyleSheets = [...root2.adoptedStyleSheets, sheet];
    } catch {
      const style = doc.createElement("style");
      style.textContent = css;
      (root2.nodeType === 9 ? doc.head || doc.documentElement : root2).append(style);
    }
  }
  var ICONS = {
    play: "M8 5v14l11-7z",
    pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
    replay: "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z",
    volume: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
    muted: "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z",
    close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    tune: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
    pip: "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"
  };
  var SVG = "http://www.w3.org/2000/svg";
  function icon(doc, name) {
    const svg = doc.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    const path = doc.createElementNS(SVG, "path");
    const seek = name === "back10" || name === "fwd10";
    path.setAttribute("d", ICONS[seek ? "replay" : name]);
    if (name === "fwd10") path.setAttribute("transform", "matrix(-1 0 0 1 24 0)");
    svg.append(path);
    if (seek) {
      const t = doc.createElementNS(SVG, "text");
      t.setAttribute("x", "12");
      t.setAttribute("y", "15.6");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", "6.5");
      t.setAttribute("font-weight", "700");
      t.setAttribute("font-family", "system-ui, sans-serif");
      t.textContent = "10";
      svg.append(t);
    }
    return svg;
  }

  // src/launcher.ts
  var DWELL_MS = 400;
  var root = null;
  var host = null;
  function layer(doc) {
    if (!root || !host) {
      host = doc.createElement("video-pip-ui");
      root = host.attachShadow({ mode: "closed" });
      adoptCss(root, page_default);
    }
    if (!host.isConnected) doc.documentElement.append(host);
    return root;
  }
  var toastEl = null;
  var toastTimer;
  function toast(doc, msg) {
    const r = layer(doc);
    if (!toastEl) {
      toastEl = h(doc, "div", { class: "toast", role: "status" });
      r.append(toastEl);
    }
    const el = toastEl;
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }
  function startLauncher(doc, deps) {
    let chip = null;
    let target = null;
    let shown = false;
    let dwell;
    let raf = 0;
    let x = 0, y = 0;
    function ensure() {
      if (!chip) {
        chip = h(
          doc,
          "button",
          { class: "chip", type: "button", title: "PIP로 보기 (Alt+P)", "aria-label": "PIP로 보기 (Alt+P)" },
          icon(doc, "pip"),
          h(doc, "span", { class: "lbl", text: "PIP" })
        );
        chip.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const v = target;
          hide();
          if (v) {
            deps.tracker.setManual(v);
            deps.open(v);
          }
        });
      }
      const r = layer(doc);
      if (chip.parentNode !== r) r.append(chip);
      return chip;
    }
    function place(v) {
      const c = ensure();
      const r = v.getBoundingClientRect();
      const vw = doc.documentElement.clientWidth || innerWidth;
      c.style.top = `${Math.max(r.top + deps.inset(v), 8)}px`;
      c.style.right = `${Math.max(vw - r.right + 8, 8)}px`;
      if (!shown) {
        shown = true;
        c.classList.add("show");
      }
    }
    function hide() {
      clearTimeout(dwell);
      target = null;
      if (shown && chip) chip.classList.remove("show");
      shown = false;
    }
    function update() {
      raf = 0;
      if (!deps.tracker.videos().length) return hide();
      if (!deps.enabled() || deps.busy() || doc.fullscreenElement) return hide();
      const v = deps.tracker.at(x, y);
      if (!v) return hide();
      if (v !== target) {
        hide();
        target = v;
        dwell = setTimeout(() => {
          if (target === v) place(v);
        }, DWELL_MS);
      } else if (shown) {
        place(v);
      }
    }
    doc.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      x = e.clientX;
      y = e.clientY;
      if (!raf) raf = requestAnimationFrame(update);
    }, { capture: true, passive: true });
    const quietHide = () => {
      if (target) hide();
    };
    window.addEventListener("scroll", quietHide, { capture: true, passive: true });
    window.addEventListener("resize", quietHide, { passive: true });
    window.addEventListener("blur", quietHide);
    doc.addEventListener("fullscreenchange", quietHide);
    doc.addEventListener("mouseout", (e) => {
      if (!e.relatedTarget) quietHide();
    });
  }

  // src/styles/player.css
  var player_default = "/* PiP 창 안 플레이어. 이 스타일시트는 PiP 창 문서에만 있으므로, 영상이 돌아가면 효과도 저절로 사라진다. */\n:root {\n  color-scheme: dark;\n  --fg: #f1f4f8;\n  --dim: #b4bdc9;\n  --accent: #4f9dff;\n  --panel: rgba(20, 24, 32, 0.96);\n  font: 13px/1.3 system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;\n}\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { height: 100%; overflow: hidden; background: #000; color: var(--fg); }\nbutton { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: none; }\nbutton:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }\nsvg { display: block; }\n[hidden] { display: none !important; }\n\n.stage { position: fixed; inset: 0; container: stage / inline-size; user-select: none; -webkit-user-select: none; }\n\n/* 영상: 사이트가 넣은 인라인 크기·위치를 덮어쓰기만 하고 지우지는 않는다(Zero-touch) */\n.slot { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #000; }\n.slot > video {\n  position: static !important; display: block !important;\n  width: 100% !important; height: 100% !important;\n  min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important;\n  margin: 0 !important; inset: auto !important; transform: none !important; filter: none !important;\n  object-fit: contain !important; opacity: 1 !important; visibility: visible !important;\n}\n/* controls 속성이 있는 영상의 브라우저 기본 컨트롤 숨김(Chromium). 별도 규칙이라 다른 브라우저에서 무시돼도 위 규칙은 유지 */\n.slot > video::-webkit-media-controls { display: none !important; }\n\n/* 오버레이: 항상 클릭을 받고(빈 곳 클릭 = 재생/일시정지), 숨김 상태에선 내용만 감춘다 */\n.ov { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; }\n.ov.idle { cursor: none; }\n.top, .mid, .bot { transition: opacity .14s ease, visibility 0s; }\n.ov.idle .top, .ov.idle .mid, .ov.idle .bot { opacity: 0; visibility: hidden; transition: opacity .32s ease, visibility 0s linear .32s; }\n\n.top { position: relative; z-index: 1; display: flex; align-items: center; gap: 2px; padding: 6px 6px 20px 12px; background: linear-gradient(rgba(0, 0, 0, .7), transparent); }\n.ttl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; text-shadow: 0 1px 2px rgba(0, 0, 0, .6); }\n\n.mid { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 28px; pointer-events: none; }\n.mid > button { pointer-events: auto; }\n\n.bot { position: relative; z-index: 1; padding: 22px 10px 4px; background: linear-gradient(transparent, rgba(0, 0, 0, .75)); }\n\n.ib { width: 32px; height: 32px; border-radius: 8px; }\n.ib:hover { background: rgba(255, 255, 255, .14); }\n.ib svg { width: 20px; height: 20px; }\n.cb { width: 44px; height: 44px; border-radius: 50%; background: rgba(0, 0, 0, .45); }\n.cb svg { width: 26px; height: 26px; }\n.cb.big { width: 60px; height: 60px; }\n.cb.big svg { width: 34px; height: 34px; }\n.cb:hover { background: rgba(79, 157, 255, .9); }\n\n/* 시크바 */\n.seek { position: relative; height: 18px; display: flex; align-items: center; cursor: pointer; touch-action: none; }\n.track { position: relative; width: 100%; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .25); transition: height .1s; }\n.seek:hover .track, .seek.drag .track { height: 6px; }\n.buf, .played { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: inherit; }\n.buf { background: rgba(255, 255, 255, .35); }\n.played { background: var(--accent); }\n.thumb { position: absolute; top: 50%; left: 0; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; background: var(--accent); transform: scale(0); transition: transform .1s; }\n.seek:hover .thumb, .seek.drag .thumb { transform: scale(1); }\n.tip { position: absolute; bottom: 20px; left: 0; transform: translateX(-50%); padding: 2px 6px; border-radius: 6px; background: var(--panel); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none; display: none; }\n.seek:hover .tip, .seek.drag .tip { display: block; }\n.seek.is-live .track { cursor: pointer; }\n\n.row { display: flex; align-items: center; gap: 2px; height: 34px; }\n.time { padding: 0 6px; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--dim); white-space: nowrap; }\n.live { height: 20px; padding: 0 7px; margin: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: .3px; background: rgba(255, 255, 255, .16); }\n.live.edge { background: #e53935; }\n.grow { flex: 1; }\n.vol { width: 72px; height: 4px; accent-color: var(--accent); cursor: pointer; }\n.rate { min-width: 46px; height: 26px; padding: 0 9px; margin-left: 4px; border-radius: 13px; background: rgba(255, 255, 255, .12); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }\n.rate:hover { background: rgba(255, 255, 255, .2); }\n.rate.on { color: #ffb84f; }\n\n/* ⚙ 팝오버 */\n.pop { position: absolute; z-index: 2; top: 42px; right: 8px; width: 264px; max-width: calc(100% - 16px); max-height: calc(100% - 52px); overflow: auto; padding: 6px; border-radius: 12px; background: var(--panel); border: 1px solid rgba(255, 255, 255, .1); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }\n.pop[hidden] { display: none; }\n.opt { display: flex; width: 100%; align-items: center; gap: 10px; padding: 9px 8px; border-radius: 8px; text-align: left; font-size: 12.5px; }\n.opt:hover { background: rgba(255, 255, 255, .08); }\n.opt .lbl { flex: 1; }\n.opt .sub { display: block; margin-top: 2px; font-size: 11px; color: var(--dim); }\n.sw { position: relative; flex: none; width: 32px; height: 18px; border-radius: 9px; background: rgba(255, 255, 255, .25); transition: background .15s; }\n.sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s; }\n.opt[aria-checked='true'] .sw { background: var(--accent); }\n.opt[aria-checked='true'] .sw::after { transform: translateX(14px); }\n.ver { padding: 6px 8px 3px; font-size: 11px; color: var(--dim); }\n\n/* 첫 진입 힌트 */\n.hint { position: absolute; z-index: 3; left: 50%; top: 48px; transform: translateX(-50%); max-width: calc(100% - 24px); padding: 8px 12px; border-radius: 10px; background: rgba(79, 157, 255, .95); color: #fff; font-size: 12px; text-align: center; pointer-events: none; transition: opacity .4s; }\n.hint.out { opacity: 0; }\n\n/* 좁은 창: 중앙은 재생 버튼만, 하단은 재생 · 시간 · 배속 */\n@container stage (max-width: 359px) {\n  .mid .side, .mute, .vol { display: none; }\n  .ttl { font-size: 12px; }\n}\n/* 낮은 창: 중앙 버튼 생략 */\n@media (max-height: 200px) {\n  .mid { display: none; }\n  .top { padding-bottom: 8px; }\n  .bot { padding-top: 8px; }\n}\n@media (prefers-reduced-motion: reduce) {\n  *, *::after { transition: none !important; }\n}\n";

  // src/player-ui.ts
  var HIDE_MS = 2400;
  function mountPlayerUI(win, first, deps) {
    const doc = win.document;
    doc.documentElement.lang = "ko";
    doc.title = deps.title;
    adoptCss(doc, player_default);
    let video = first;
    const btn = (cls, id, name) => {
      const label = deps.hint(id);
      return h(doc, "button", { class: cls, type: "button", title: label, "aria-label": label, onclick: () => deps.run(id) }, icon(doc, name));
    };
    const slot = h(doc, "div", { class: "slot" });
    const ttl = h(doc, "div", { class: "ttl", text: deps.title });
    const gear = h(doc, "button", { class: "ib", type: "button", title: "설정", "aria-label": "설정", "aria-expanded": "false" }, icon(doc, "tune"));
    const closeB = btn("ib", "close", "close");
    const top = h(doc, "div", { class: "top" }, ttl, gear, closeB);
    const playC = btn("cb big", "play", "pause");
    const mid = h(doc, "div", { class: "mid" }, btn("cb side", "back10", "back10"), playC, btn("cb side", "fwd10", "fwd10"));
    const buf = h(doc, "div", { class: "buf" });
    const played = h(doc, "div", { class: "played" });
    const thumb = h(doc, "div", { class: "thumb" });
    const track = h(doc, "div", { class: "track" }, buf, played, thumb);
    const tip = h(doc, "div", { class: "tip" });
    const seek = h(doc, "div", { class: "seek", role: "slider", "aria-label": "재생 위치", tabindex: "-1" }, track, tip);
    const playB = btn("ib", "play", "pause");
    const time = h(doc, "span", { class: "time" });
    const liveB = h(doc, "button", { class: "live", type: "button", title: "실시간으로", text: "LIVE", onclick: () => deps.toLiveEdge(video) });
    const muteB = btn("ib mute", "mute", "volume");
    const vol = h(doc, "input", { class: "vol", type: "range", min: "0", max: "100", step: "1", "aria-label": "볼륨" });
    const rate = h(doc, "button", { class: "rate", type: "button", title: "배속 (클릭: 바꾸기 · [ / ] / =)", "aria-label": "배속", onclick: () => deps.run("rateCycle") });
    const row = h(doc, "div", { class: "row" }, playB, time, liveB, h(doc, "span", { class: "grow" }), muteB, vol, rate);
    const bot = h(doc, "div", { class: "bot" }, seek, row);
    const ov = h(doc, "div", { class: "ov" }, top, mid, bot);
    const pop = buildPopover(doc, deps.config);
    const stage = h(doc, "div", { class: "stage" }, slot, ov, pop.root);
    doc.body.append(stage);
    let visible = true;
    let dragging = false;
    let live = false;
    const refreshLive = () => {
      live = deps.isLive(video);
    };
    const setIcon = (b, name) => b.replaceChildren(icon(doc, name));
    function renderProgress() {
      const isLive2 = live;
      const r = seekRange(video);
      time.hidden = isLive2;
      liveB.hidden = !isLive2;
      seek.classList.toggle("is-live", isLive2);
      if (isLive2) {
        liveB.classList.toggle("edge", !r || r.end - video.currentTime < 15);
      } else {
        time.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
      }
      const span = r ? r.end - r.start : 0;
      const p = span > 0 ? clamp((video.currentTime - r.start) / span, 0, 1) : isLive2 ? 1 : 0;
      played.style.width = `${p * 100}%`;
      thumb.style.left = `${p * 100}%`;
      const b = video.buffered;
      buf.style.width = span > 0 && b.length ? `${clamp((b.end(b.length - 1) - r.start) / span, 0, 1) * 100}%` : "0";
      seek.setAttribute("aria-valuetext", isLive2 ? "실시간" : time.textContent ?? "");
    }
    function renderPlay() {
      const paused = video.paused || video.ended;
      const name = paused ? "play" : "pause";
      setIcon(playC, name);
      setIcon(playB, name);
      if (paused) show();
      else armHide();
    }
    function renderVolume() {
      const off = video.muted || video.volume === 0;
      setIcon(muteB, off ? "muted" : "volume");
      vol.value = String(Math.round((video.muted ? 0 : video.volume) * 100));
      vol.setAttribute("aria-valuetext", `${vol.value}%`);
    }
    function renderRate() {
      const r = video.playbackRate;
      rate.textContent = `${Number(r.toFixed(2))}x`;
      rate.classList.toggle("on", r !== 1);
    }
    const renderAll = () => {
      renderProgress();
      renderPlay();
      renderVolume();
      renderRate();
    };
    let unbind = () => {
    };
    function bind(v) {
      unbind();
      const on = [
        ["play", renderPlay],
        ["pause", renderPlay],
        ["ended", renderPlay],
        ["timeupdate", () => visible && !dragging && renderProgress()],
        // 숨김 상태에선 DOM 쓰기 0
        ["progress", () => visible && renderProgress()],
        ["durationchange", onMeta],
        ["loadedmetadata", onMeta],
        ["emptied", onMeta],
        ["playing", onMeta],
        ["volumechange", renderVolume],
        ["ratechange", renderRate]
      ];
      on.forEach(([t, fn]) => v.addEventListener(t, fn));
      unbind = () => on.forEach(([t, fn]) => v.removeEventListener(t, fn));
      video = v;
      refreshLive();
      renderAll();
    }
    function onMeta() {
      refreshLive();
      renderProgress();
    }
    let hideTimer = 0;
    function show() {
      if (!visible) {
        visible = true;
        ov.classList.remove("idle");
        renderProgress();
      }
      armHide();
    }
    function armHide() {
      win.clearTimeout(hideTimer);
      hideTimer = win.setTimeout(() => {
        const keyboard = doc.activeElement?.matches(":focus-visible") && doc.activeElement !== doc.body;
        if (video.paused || dragging || pop.isOpen() || keyboard) return;
        visible = false;
        ov.classList.add("idle");
      }, HIDE_MS);
    }
    stage.addEventListener("pointermove", show);
    stage.addEventListener("pointerdown", show);
    doc.addEventListener("focusin", show);
    doc.addEventListener("mouseout", (e) => {
      if (e.relatedTarget || video.paused || dragging || pop.isOpen()) return;
      win.clearTimeout(hideTimer);
      visible = false;
      ov.classList.add("idle");
    });
    ov.addEventListener("click", (e) => {
      if (e.target !== ov && e.target !== mid) return;
      if (pop.isOpen()) closePop();
      else deps.run("play");
    });
    stage.addEventListener("wheel", (e) => {
      if (pop.root.contains(e.target)) return;
      const d = e.deltaY || e.deltaX;
      if (!d) return;
      e.preventDefault();
      if (e.shiftKey) nudgeRate(video, d < 0 ? 0.25 : -0.25);
      else changeVolume(video, d < 0 ? 0.05 : -0.05);
      show();
    }, { passive: false });
    vol.addEventListener("input", () => {
      video.volume = Number(vol.value) / 100;
      video.muted = video.volume === 0;
    });
    const ratioAt = (x) => {
      const r = track.getBoundingClientRect();
      return r.width > 0 ? clamp((x - r.left) / r.width, 0, 1) : 0;
    };
    const showTip = (x) => {
      const ratio = ratioAt(x);
      const r = seekRange(video);
      tip.style.left = `${ratio * 100}%`;
      if (!r) {
        tip.textContent = "";
        return;
      }
      const t = r.start + ratio * (r.end - r.start);
      tip.textContent = live ? `-${fmtTime(r.end - t)}` : fmtTime(t);
    };
    seek.addEventListener("pointerdown", (e) => {
      dragging = true;
      seek.classList.add("drag");
      try {
        seek.setPointerCapture(e.pointerId);
      } catch {
      }
      seekToRatio(video, ratioAt(e.clientX));
      showTip(e.clientX);
      renderProgress();
    });
    seek.addEventListener("pointermove", (e) => {
      showTip(e.clientX);
      if (dragging) {
        seekToRatio(video, ratioAt(e.clientX));
        renderProgress();
      }
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      seek.classList.remove("drag");
      armHide();
    };
    seek.addEventListener("pointerup", endDrag);
    seek.addEventListener("pointercancel", endDrag);
    seek.addEventListener("lostpointercapture", endDrag);
    function closePop() {
      pop.close();
      gear.setAttribute("aria-expanded", "false");
    }
    gear.addEventListener("click", () => {
      pop.toggle();
      gear.setAttribute("aria-expanded", String(pop.isOpen()));
      show();
    });
    doc.addEventListener("keydown", (e) => {
      show();
      if (e.code === "Escape" && pop.isOpen()) {
        e.preventDefault();
        closePop();
        return;
      }
      deps.onKey(e);
    }, true);
    if (!deps.config.get().hinted) {
      const hint = h(doc, "div", { class: "hint", text: "마우스를 올리면 컨트롤 · 휠 = 볼륨 · Shift+휠 = 배속" });
      stage.append(hint);
      win.setTimeout(() => hint.classList.add("out"), 3600);
      win.setTimeout(() => hint.remove(), 4100);
      deps.config.set({ hinted: true });
    }
    bind(first);
    show();
    return {
      slot,
      setVideo: bind,
      setTitle(t) {
        ttl.textContent = t;
        doc.title = t;
      },
      destroy() {
        unbind();
        pop.destroy();
        win.clearTimeout(hideTimer);
      }
    };
  }
  function buildPopover(doc, config) {
    const opts = [];
    const option = (label, sub, get, set) => {
      const el = h(
        doc,
        "button",
        { class: "opt", type: "button", role: "switch" },
        h(doc, "span", { class: "lbl" }, label, h(doc, "span", { class: "sub", text: sub })),
        h(doc, "span", { class: "sw", "aria-hidden": "true" })
      );
      el.addEventListener("click", () => set(!get()));
      opts.push({ el, get });
      return el;
    };
    const root2 = h(
      doc,
      "div",
      { class: "pop", role: "dialog", "aria-label": "설정", hidden: true },
      option(
        "탭 전환 시 자동 PIP",
        "Chrome 134+ · 소리 나는 영상을 재생 중일 때",
        () => config.get().autoTabPip,
        (on) => config.set({ autoTabPip: on })
      ),
      option(
        "영상 위 ⧉ 버튼 표시",
        "꺼도 Alt+P로 열 수 있어요",
        () => config.get().launcher,
        (on) => config.set({ launcher: on })
      ),
      option(
        "이 사이트에서는 버튼·자동 PIP 끄기",
        location.hostname,
        () => config.siteDisabled(),
        (off) => config.setSiteDisabled(off)
      ),
      h(doc, "div", { class: "ver", text: `v${"2.0.1"} · Alt+P로 언제든 켜고 끌 수 있어요` })
    );
    const sync = () => opts.forEach((o) => o.el.setAttribute("aria-checked", String(o.get())));
    sync();
    const unsub = config.subscribe(sync);
    return {
      root: root2,
      isOpen: () => !root2.hidden,
      toggle() {
        root2.hidden = !root2.hidden;
      },
      close() {
        root2.hidden = true;
      },
      destroy: unsub
    };
  }

  // src/dock.ts
  var IN_FLOW = /* @__PURE__ */ new Set(["static", "relative", "sticky"]);
  function detach(video) {
    const parent = video.parentNode;
    if (!parent) throw new Error("영상이 문서에 붙어 있지 않습니다");
    const doc = video.ownerDocument;
    const anchor = doc.createComment("video-pip");
    parent.insertBefore(anchor, video);
    let spacer = null;
    const cs = doc.defaultView?.getComputedStyle(video);
    const rect = video.getBoundingClientRect();
    if (cs && IN_FLOW.has(cs.position || "static") && cs.display !== "none" && rect.width > 0 && rect.height > 0) {
      spacer = doc.createElement("div");
      spacer.setAttribute("data-video-pip-spacer", "");
      const s = spacer.style;
      s.display = cs.display.startsWith("inline") ? "inline-block" : "block";
      s.boxSizing = "border-box";
      s.width = `${rect.width}px`;
      s.height = `${rect.height}px`;
      s.margin = `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`;
      s.verticalAlign = cs.verticalAlign;
      s.flex = "none";
      s.background = "#000";
      parent.insertBefore(spacer, video);
    }
    return { video, anchor, spacer, parent, done: false };
  }
  function moveTo(token, slot) {
    slot.append(token.video);
  }
  function restore(token) {
    if (token.done) return;
    token.done = true;
    const { video, anchor, spacer, parent } = token;
    const wasPlaying = !video.paused && !video.ended;
    if (anchor.parentNode) anchor.parentNode.insertBefore(video, anchor);
    else if (parent.isConnected) parent.appendChild(video);
    else video.remove();
    anchor.remove();
    spacer?.remove();
    if (wasPlaying && video.isConnected) {
      setTimeout(() => {
        if (video.paused && !video.ended) video.play()?.catch(() => {
        });
      }, 200);
    }
  }

  // src/session.ts
  var MSG = {
    noVideo: "영상을 찾지 못했어요. 영상을 재생한 뒤 다시 시도해 주세요.",
    unsupported: "이 브라우저나 영상은 PIP를 지원하지 않아요.",
    retry: "PIP를 열지 못했어요. 영상을 클릭하거나 Alt+P를 다시 눌러 주세요."
  };
  function createSession(deps) {
    let seq = 0;
    let active = null;
    let opening = false;
    let queue = Promise.resolve();
    let pendingOpen = null;
    const subs = /* @__PURE__ */ new Set();
    const mode = () => opening ? "opening" : active ? active.kind : "idle";
    const emit = () => {
      const m = mode();
      subs.forEach((fn) => {
        try {
          fn(m);
        } catch (e) {
          warn(e);
        }
      });
    };
    const enqueue = (fn) => queue = queue.then(fn).catch((e) => warn("전환 실패", e));
    function teardown(id) {
      const a = active;
      if (!a || a.id !== id) return;
      active = null;
      for (const fn of a.cleanup) {
        try {
          fn();
        } catch (e) {
          warn(e);
        }
      }
      try {
        a.ui?.destroy();
      } catch (e) {
        warn(e);
      }
      if (a.token) {
        restore(a.token);
        window.dispatchEvent(new Event("resize"));
      }
      emit();
    }
    function closeActive() {
      const a = active;
      if (!a) return;
      teardown(a.id);
      if (a.kind === "doc") {
        try {
          a.win?.close();
        } catch {
        }
      } else deps.exitLegacy();
    }
    async function openDoc(video, reason) {
      let win;
      try {
        win = await deps.requestWindow(video);
      } catch (e) {
        warn("Document PiP 실패", e);
        if (reason === "auto" && deps.legacyAvailable(video)) return openLegacy(video);
        deps.toast(MSG.retry);
        return;
      }
      const a = { id: ++seq, kind: "doc", video, win, cleanup: [] };
      try {
        a.ui = deps.mountUI(win, video);
        a.token = detach(video);
        moveTo(a.token, a.ui.slot);
        active = a;
        const id = a.id;
        win.addEventListener("pagehide", () => teardown(id), { once: true });
      } catch (e) {
        if (a.token) restore(a.token);
        try {
          a.ui?.destroy();
        } catch {
        }
        try {
          win.close();
        } catch {
        }
        throw e;
      }
    }
    async function openLegacy(video) {
      if (!deps.legacyAvailable(video)) {
        deps.toast(MSG.unsupported);
        return;
      }
      try {
        await deps.requestLegacy(video);
      } catch (e) {
        warn("PiP 실패", e);
        deps.toast(MSG.retry);
        return;
      }
      const a = { id: ++seq, kind: "legacy", video, cleanup: [] };
      const id = a.id;
      const onLeave = () => teardown(id);
      video.addEventListener("leavepictureinpicture", onLeave, { once: true });
      a.cleanup.push(() => video.removeEventListener("leavepictureinpicture", onLeave));
      active = a;
    }
    async function openNow(video, reason) {
      const v = video ?? deps.pick();
      if (!v) {
        if (reason === "manual") deps.toast(MSG.noVideo);
        return;
      }
      if (active) {
        if (active.video === v) return;
        closeActive();
      }
      opening = true;
      emit();
      try {
        if (deps.docPip() && !v.mediaKeys) await openDoc(v, reason);
        else await openLegacy(v);
      } finally {
        opening = false;
        emit();
      }
    }
    const session = {
      mode,
      video: () => active?.video ?? null,
      open(video, reason = "manual") {
        if (pendingOpen) return pendingOpen;
        const p = enqueue(() => openNow(video, reason)).finally(() => {
          if (pendingOpen === p) pendingOpen = null;
        });
        pendingOpen = p;
        return p;
      },
      close: () => enqueue(closeActive),
      toggle() {
        if (pendingOpen) return pendingOpen;
        return active ? session.close() : session.open();
      },
      rebind() {
        const a = active;
        if (!a || a.kind !== "doc" || !a.token || !a.ui) return;
        const cur = a.video;
        const homeGone = !a.token.anchor.isConnected;
        const sourceGone = cur.readyState === 0 && !cur.currentSrc && !cur.srcObject;
        let next = null;
        if (homeGone || sourceGone) next = deps.pick();
        else if (cur.paused || cur.ended) next = deps.follow();
        if (!next || next === cur) return;
        restore(a.token);
        a.token = detach(next);
        moveTo(a.token, a.ui.slot);
        a.video = next;
        a.ui.setVideo(next);
        a.ui.setTitle(deps.title());
        if (a.win) deps.fitWindow?.(a.win, next);
      },
      fullscreen(el) {
        const home = active?.kind === "doc" ? active.token?.anchor.parentNode : null;
        if (el && home && el.contains(home)) void session.close();
      },
      refreshTitle() {
        active?.ui?.setTitle(deps.title());
      },
      subscribe(fn) {
        subs.add(fn);
        return () => subs.delete(fn);
      }
    };
    return session;
  }

  // src/sites.ts
  var generic = {
    id: "generic",
    title: () => document.title || location.hostname
  };
  var ytPlayer = () => document.getElementById("movie_player");
  var isShorts = () => location.pathname.startsWith("/shorts");
  var youtube = {
    id: "youtube",
    // 일반 영상과 쇼츠는 플레이어가 따로 있다
    primaryVideo: () => document.querySelector(isShorts() ? "ytd-reel-video-renderer[is-active] video, #shorts-player video" : "#movie_player video.html5-main-video"),
    // "(3) 제목 - YouTube" → "제목"
    title: () => (document.title || "").replace(/^\(\d+\+?\)\s*/, "").replace(/\s*-\s*YouTube$/, "") || "YouTube",
    onNavigate: (cb) => window.addEventListener("yt-navigate-finish", cb),
    // 임베드 플레이어는 상단에 제목 바가 있어 그 아래로 내린다
    launcherInset: () => location.pathname.startsWith("/embed/") ? 56 : 8,
    // 유튜브 라이브는 영상 길이가 유한하게 나와서 플레이어 정보와 시간 표시의 라이브 표식으로 판정
    isLive(v) {
      if (v.duration === Infinity) return true;
      if (isShorts()) return false;
      try {
        if (ytPlayer()?.getVideoData?.()?.isLive === true) return true;
      } catch {
      }
      return !!document.querySelector("#movie_player .ytp-time-display.ytp-live");
    },
    toLiveEdge() {
      const p = ytPlayer();
      if (typeof p?.seekToLiveHead !== "function") return false;
      try {
        p.seekToLiveHead();
        return true;
      } catch {
        return false;
      }
    }
  };
  function pickAdapter(loc) {
    return /(^|\.)youtube(-nocookie)?\.com$/.test(loc.hostname) ? youtube : generic;
  }

  // src/tracker.ts
  function score(i) {
    if (i.tiny) return -Infinity;
    return (i.playing ? 1e3 : 0) + (i.audible ? 300 : 0) + 200 * i.visible + Math.min(i.area / 1e3, 150) + (i.primary ? 100 : 0);
  }
  var usable = (v) => v.isConnected && (v.readyState >= 1 || !!v.currentSrc || !!v.srcObject);
  function createTracker(doc, adapter) {
    const all = doc.getElementsByTagName("video");
    let manual = null;
    function info(v, primary) {
      const r = v.getBoundingClientRect();
      const vw = doc.documentElement.clientWidth || innerWidth;
      const vh = doc.documentElement.clientHeight || innerHeight;
      const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      const area = r.width * r.height;
      return {
        playing: !v.paused && !v.ended,
        audible: !v.muted && v.volume > 0,
        visible: area > 0 ? ix * iy / area : 0,
        area,
        primary: v === primary,
        tiny: r.width < 120 || r.height < 68
      };
    }
    function best(cands) {
      const primary = adapter.primaryVideo?.() ?? null;
      let top = null, topScore = -Infinity;
      for (const v of cands) {
        const s = score(info(v, primary));
        if (s > topScore) {
          top = v;
          topScore = s;
        }
      }
      return top;
    }
    return {
      pick() {
        if (manual && usable(manual) && manual.ownerDocument === doc) return manual;
        manual = null;
        return best(Array.from(all).filter(usable));
      },
      at(x, y) {
        const hits = [];
        for (const v of Array.from(all)) {
          if (!usable(v)) continue;
          const r = v.getBoundingClientRect();
          if (r.width >= 200 && r.height >= 112 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hits.push(v);
        }
        return hits.length > 1 ? best(hits) : hits[0] ?? null;
      },
      setManual(v) {
        manual = v;
      },
      prominent(v) {
        const primary = adapter.primaryVideo?.() ?? null;
        const i = info(v, primary);
        const vw = doc.documentElement.clientWidth || innerWidth;
        const vh = doc.documentElement.clientHeight || innerHeight;
        return i.playing && !i.tiny && i.area * i.visible / (vw * vh) >= 0.2 && (i.audible || i.primary);
      },
      videos: () => all
    };
  }

  // src/main.ts
  function boot() {
    const w = window;
    if (w.__videoPip) return;
    w.__videoPip = "2.0.1";
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
          try {
            win.resizeTo(width + win.outerWidth - win.innerWidth, height + win.outerHeight - win.innerHeight);
          } catch {
          }
        };
        if (v.videoWidth) fit();
        else v.addEventListener("loadedmetadata", fit, { once: true });
      },
      title: () => adapter.title(),
      docPip: () => top && !!window.documentPictureInPicture,
      requestWindow: (v) => window.documentPictureInPicture.requestWindow(pipWindowSize(v, config.get().pipLongEdge)),
      mountUI(win, v) {
        const ui = mountPlayerUI(win, v, {
          title: adapter.title(),
          run: (id) => keymap.run(id),
          hint: (id) => keymap.hint(id),
          onKey: (e) => keymap.handle(e, "player"),
          config,
          isLive: (x) => adapter.isLive?.(x) ?? isLive(x),
          toLiveEdge: (x) => {
            if (!adapter.toLiveEdge?.(x)) toLiveEdge(x);
          }
        });
        win.addEventListener("resize", debounce(() => {
          config.set({ pipLongEdge: Math.max(win.innerWidth, win.innerHeight) });
        }, 500));
        const titleEl = document.querySelector("head > title");
        if (titleEl) {
          const mo = new MutationObserver(() => session.refreshTitle());
          mo.observe(titleEl, { childList: true, characterData: true, subtree: true });
          win.addEventListener("pagehide", () => mo.disconnect(), { once: true });
        }
        for (const type of ["emptied", "pause", "ended"]) win.document.addEventListener(type, scheduleRebind, true);
        return ui;
      },
      legacyAvailable: (v) => document.pictureInPictureEnabled && !v.disablePictureInPicture,
      requestLegacy: (v) => v.requestPictureInPicture().then(() => void 0),
      exitLegacy: () => {
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {
        });
      },
      toast: (msg) => toast(document, msg)
    });
    const keymap = createKeymap(buildCommands(session));
    window.addEventListener("keydown", (e) => keymap.handle(e, "global"), true);
    let rebindTimer;
    function scheduleRebind() {
      clearTimeout(rebindTimer);
      rebindTimer = setTimeout(() => session.rebind(), 50);
    }
    for (const type of ["loadedmetadata", "play", "playing", "emptied"]) document.addEventListener(type, scheduleRebind, true);
    adapter.onNavigate?.(() => {
      scheduleRebind();
      syncAutoPip();
    });
    document.addEventListener("fullscreenchange", () => session.fullscreen(document.fullscreenElement));
    window.addEventListener("pagehide", () => config.flush());
    let autoRegistered = false;
    function syncAutoPip() {
      if (!top || !("mediaSession" in navigator)) return;
      const on = config.get().autoTabPip && !config.siteDisabled();
      if (!on && !autoRegistered) return;
      try {
        navigator.mediaSession.setActionHandler(
          "enterpictureinpicture",
          on ? () => {
            if (session.mode() === "idle") void session.open(null, "auto");
          } : null
        );
        autoRegistered = on;
      } catch {
      }
    }
    syncAutoPip();
    config.subscribe(syncAutoPip);
    startLauncher(document, {
      tracker,
      enabled: () => config.get().launcher && !config.siteDisabled(),
      busy: () => session.mode() === "opening",
      open: (v) => void session.open(v),
      inset: (v) => adapter.launcherInset?.(v) ?? 8
    });
  }
  try {
    boot();
  } catch (e) {
    warn("시작 실패", e);
  }
})();
