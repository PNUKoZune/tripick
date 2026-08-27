import { readJson, removeStored, writeJson } from '@/shared/lib/storage';

/**
 * 카카오 로그인을 **이 브라우저가 시작했다**는 증거.
 *
 * 로그인 시작 URL 에 `bind` 로 실어 보내면 서버가 그 해시를 교환 코드에 묶고, 교환할 때
 * 같은 값을 다시 제시해야 세션이 나온다. 이게 없으면 교환 코드는 URL 에 실린 그 자체로
 * 세션이라, 공격자가 자기 카카오 로그인으로 얻은 코드를 피해자에게 링크(웹) 또는
 * `tripick://auth/kakao/callback?code=…` 딥링크(앱)로 던져 **피해자를 공격자 계정으로**
 * 로그인시킬 수 있다. 시작 단계의 `state` 쿠키는 카카오 왕복만 지켜서 이 홉을 못 막는다.
 *
 * sessionStorage 가 아니라 localStorage 인 이유: Android 는 카카오 동의를 시스템 브라우저에서
 * 받고 App Link 로 앱에 돌아와 **웹뷰를 새 URL 로 다시 로드**한다. 그 사이 브라우징 컨텍스트가
 * 갈리면 sessionStorage 는 비어 카카오 로그인이 통째로 죽는다.
 *
 * 오래 남은 값이 위험하지 않은 이유: 서버는 "코드에 실린 해시"와 대조하므로, 피해자에게 남은
 * 옛 verifier 는 공격자 코드의 해시와 애초에 안 맞는다. 그래도 성공하면 바로 지운다.
 */
const BIND_KEY = 'tripick.kakao.bind';

/** 32바이트 → base64url 43자. 서버 검증 규칙(`^[A-Za-z0-9_-]{32,256}$`)을 만족한다. */
function generateBindSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 새 bind 비밀을 만들어 보관하고 돌려준다(로그인 시작 시점). */
export function startKakaoBind(): string {
  const secret = generateBindSecret();
  writeJson(BIND_KEY, secret);
  return secret;
}

/** 교환 때 제시할 bind 비밀. 없으면 빈 문자열 — 서버가 거절한다. */
export function readKakaoBind(): string {
  return readJson<string>(BIND_KEY) ?? '';
}

/** 교환이 끝나면 지운다(성공·실패 모두 1회용). */
export function clearKakaoBind(): void {
  removeStored(BIND_KEY);
}
