/**
 * 약관·개인정보처리방침 문서의 뒤로가기 목적지.
 *
 * 이 문서들은 설정에서만 열리는 게 아니라 가입·로그인 화면의 동의 문구에서도 열린다.
 * 뒤로가기가 항상 설정으로 가면 가입하다 들어온 사용자가 엉뚱한 화면에 떨어지므로,
 * 진입점이 `?from=` 으로 자기를 알려 준다.
 *
 * ⚠️ 값은 **화이트리스트로만** 경로로 바꾼다. 쿼리 문자열을 그대로 href 에 넣으면
 * 남이 만든 링크로 임의 주소(오픈 리다이렉트)에 뒤로가기 버튼을 달아 줄 수 있다.
 */
const BACK_TARGETS = {
  signup: { href: '/signup', label: '회원가입' },
  login: { href: '/login', label: '로그인' },
  start: { href: '/start', label: '시작하기' },
  kakao: { href: '/auth/kakao/callback', label: '가입' },
} as const;

const DEFAULT_BACK = { href: '/settings', label: '설정' };

export type DocumentBackTarget = { href: string; label: string };

export function resolveDocumentBack(from?: string): DocumentBackTarget {
  if (from && from in BACK_TARGETS) return BACK_TARGETS[from as keyof typeof BACK_TARGETS];
  return DEFAULT_BACK;
}
