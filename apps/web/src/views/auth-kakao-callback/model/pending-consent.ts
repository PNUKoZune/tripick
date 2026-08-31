import { readJson, removeStored, writeJson } from '@/shared/lib/storage';

/**
 * 약관 동의 대기 중인 카카오 가입.
 *
 * 서버가 준 가입 코드는 URL 이 아니라 React state 에만 있다(콜백 코드는 교환 직후 URL 에서
 * 지운다). 동의 화면에서 새로고침하거나 뒤로 갔다 오면 그 state 가 사라져 카카오 로그인부터
 * 다시 해야 하므로, 화면이 살아 있는 동안만 붙잡아 둔다.
 *
 * 약관 전문은 모달로 띄우므로 이 화면을 떠나지 않는다 — 그쪽 때문에 필요한 건 아니다.
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
