import { readJson, removeStored, writeJson } from '@/shared/lib/storage';

/**
 * 약관 동의 대기 중인 카카오 가입.
 *
 * 동의 화면에서 약관 전문을 누르면 같은 탭으로 문서 페이지에 다녀오는데(웹뷰에서 새 탭이
 * 안 열린다 — `shared/ui/legal-consent` 참고), 그 사이 화면이 언마운트되면서 서버가 준
 * 가입 코드가 React state 와 함께 사라진다. 그러면 사용자는 카카오 로그인부터 다시 해야 한다.
 *
 * localStorage 가 아니라 **sessionStorage**: 이 값은 지금 이 탭에서 진행 중인 가입 절차이고,
 * 서버 쪽 대기표도 10분이면 만료된다. 탭을 닫으면 같이 사라지는 게 맞다.
 *
 * 코드가 새어도 만들 수 있는 건 이 브라우저의 bind 와 짝이 맞을 때의 **본인 계정**뿐이다
 * (서버가 bind 해시를 대조한다).
 */
const KEY = 'tripick.kakao.pendingConsent';

export type PendingKakaoConsent = {
  consentCode: string;
  nickname?: string;
};

export function writePendingKakaoConsent(value: PendingKakaoConsent): void {
  writeJson(KEY, value, 'session');
}

export function readPendingKakaoConsent(): PendingKakaoConsent | null {
  const value = readJson<PendingKakaoConsent>(KEY, 'session');
  return value && typeof value.consentCode === 'string' && value.consentCode ? value : null;
}

export function clearPendingKakaoConsent(): void {
  removeStored(KEY, 'session');
}
