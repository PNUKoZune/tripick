import type { NotificationCategory } from './inbox';

/** 인박스 카테고리별 푸시/인박스 수신 여부 + 친구 요청 토글 */
export type NotificationPreferenceKey = NotificationCategory | 'friend_request';

export type NotificationPreferencesDto = Record<NotificationPreferenceKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesDto = {
  replan_ready: true,
  weather_alert: true,
  crowd_alert: true,
  arrival_alert: true,
  trip_reminder: true,
  trip_invite: true,
  schedule_change_request: true,
  schedule_change_result: true,
  general: true,
  friend_request: true,
};

/** 닉네임 최대 길이. FE 입력 maxLength 와 BE 검증이 같은 값을 본다. */
export const NICKNAME_MAX_LENGTH = 20;

export interface UserDto {
  id: string;
  kakaoId: string;
  nickname: string;
  /** 친구 추가·멘션용 고유 핸들 (예: "koty") */
  handle?: string;
  profileImageUrl?: string;
  email?: string;
  notificationPreferences?: NotificationPreferencesDto;
  /**
   * 비밀번호가 설정된 계정인지. 카카오 단독 가입자는 false — 설정 화면이 "변경"(현재
   * 비밀번호 확인)과 "설정"(재설정 메일)을 이 값으로 가른다. 해시 자체는 절대 나가지 않는다.
   */
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 프로필 이미지는 여기 없다 — 전용 업로드/삭제 엔드포인트(`/users/me/profile-image`)만
 * 바꿀 수 있다. 이 경로로 열어 두면 임의 외부 URL 을 프로필 사진으로 앉힐 수 있다.
 */
export interface UpdateUserDto {
  nickname?: string;
  /** 영문 소문자/숫자/밑줄 3~20자. 중복 불가. */
  handle?: string;
}

export interface UpdateNotificationPreferencesDto {
  /** 일부만 보내 부분 갱신 가능 */
  preferences: Partial<NotificationPreferencesDto>;
}

/** 탈퇴 사유 객관식. 선택은 선택사항(건너뛰기 가능)이고, 'other' 는 자유 입력과 함께 온다. */
export const WITHDRAWAL_REASONS = [
  { code: 'not_useful', label: '여행 계획에 별 도움이 안 됐어요' },
  { code: 'bad_recommendation', label: '추천 장소가 제 취향과 안 맞았어요' },
  { code: 'hard_to_use', label: '쓰기 불편하고 어려웠어요' },
  { code: 'too_many_notifications', label: '알림이 너무 많았어요' },
  { code: 'privacy', label: '위치·사진 등 개인정보 수집이 부담됐어요' },
  { code: 'no_plan', label: '당분간 여행 계획이 없어요' },
  { code: 'other', label: '기타' },
] as const;

export type WithdrawalReasonCode = (typeof WITHDRAWAL_REASONS)[number]['code'];

/** 오탈자·오조작 방지용. 사용자가 이 문자열을 그대로 입력해야 탈퇴가 진행된다. */
export const WITHDRAWAL_CONFIRM_PHRASE = '탈퇴';

export interface WithdrawUserDto {
  /** 미선택(건너뛰기) 가능 */
  reason?: WithdrawalReasonCode;
  /** 'other' 선택 시 자유 입력, 그 외 사유의 부연 설명. 최대 500자 */
  reasonDetail?: string;
  /** WITHDRAWAL_CONFIRM_PHRASE 와 일치해야 함 */
  confirmation: string;
}
