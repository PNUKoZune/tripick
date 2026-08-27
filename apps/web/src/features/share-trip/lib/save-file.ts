'use client';

import { getReactNativeWebView } from '@/shared/rn-bridge/rn-webview';

/**
 * 만들어 둔 dataURL 을 파일로 내려준다.
 *
 * 브라우저는 `<a download>` 로 그대로 되지만, RN WebView(안드로이드)의 다운로드 리스너는
 * http/https 만 받아 `data:` URI 요청을 통째로 버린다 — 성공도 실패도 없이 아무 일도 안 일어난다.
 * 그래서 앱 안에선 base64 를 네이티브로 넘겨 다운로드 폴더에 쓰게 하고, 그 결과를 기다린다.
 */
const SAVE_TIMEOUT_MS = 20_000;

type SaveFileResult = { type: 'SAVE_FILE_RESULT'; requestId: string; ok: boolean };

export async function saveDataUrl(dataUrl: string, fileName: string, mimeType: string) {
  const rn = getReactNativeWebView();
  if (!rn) {
    triggerAnchorDownload(dataUrl, fileName);
    return;
  }

  const requestId = `save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const done = waitForResult(requestId);
  rn.postMessage(
    JSON.stringify({
      type: 'SAVE_FILE',
      requestId,
      fileName,
      mimeType,
      base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    }),
  );
  const ok = await done;
  // 실패는 호출부(공유 시트)가 자기 에러 문구로 알린다. 성공 안내는 네이티브 토스트가 띄운다.
  if (!ok) throw new Error('native save failed');
}

function waitForResult(requestId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      window.removeEventListener('message', handle);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const handle = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      let msg: SaveFileResult | null = null;
      try {
        msg = JSON.parse(event.data) as SaveFileResult;
      } catch {
        return;
      }
      if (msg?.type !== 'SAVE_FILE_RESULT' || msg.requestId !== requestId) return;
      finish(msg.ok === true);
    };
    // 구버전 앱(브리지 미구현)에선 응답이 영영 안 오므로 실패로 떨어뜨린다.
    const timer = window.setTimeout(() => finish(false), SAVE_TIMEOUT_MS);
    window.addEventListener('message', handle);
  });
}

function triggerAnchorDownload(dataUrl: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
