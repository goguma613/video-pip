// 빌드 시 esbuild define으로 주입
declare const __VERSION__: string;

// Document Picture-in-Picture (TypeScript lib.dom에 아직 없음)
interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
  preferInitialWindowPlacement?: boolean;
}
interface DocumentPictureInPicture extends EventTarget {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  readonly window: Window | null;
}
interface Window {
  readonly documentPictureInPicture?: DocumentPictureInPicture;
}

// 유저스크립트 매니저 API (@grant none이면 없음)
declare const GM_getValue: ((key: string, fallback?: unknown) => unknown) | undefined;
declare const GM_setValue: ((key: string, value: unknown) => void) | undefined;
