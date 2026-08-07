import { NICKNAME_MAX_LENGTH } from '@tripick/types';

export { NICKNAME_MAX_LENGTH };

/**
 * 닉네임 길이 초과 문구. 가입(AuthService)·수정(UsersService)·두 DTO 가 같은 문장을 쓴다 —
 * 네 군데에 복붙돼 있어 한 곳만 고치면 경로마다 다른 메시지가 나가던 자리다.
 */
export const NICKNAME_TOO_LONG = `닉네임은 ${NICKNAME_MAX_LENGTH}자 이내로 입력해주세요.`;

export const NICKNAME_REQUIRED = '닉네임을 입력해주세요.';
