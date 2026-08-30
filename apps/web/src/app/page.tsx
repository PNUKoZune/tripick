'use client';

import { GuardPlaceholder, useExpiredSessionExit, useSessionState } from '@/entities/session';
import { LandingView } from '@/views/landing/ui/landing-view';
import { TripsView } from '@/views/trips/ui/trips-view';

/**
 * 루트(`/`)는 인증 상태로 갈린다 — 로그인했으면 홈(여행 목록), 아니면 소개(랜딩).
 *
 * 서버에서 못 가르는 이유: 세션이 쿠키가 아니라 localStorage(`tripick.session.v1`) 라
 * SSR 시점엔 존재를 알 수 없다. 그래서 판정 전('pending') 에는 가드와 같은 플레이스홀더를
 * 깔고 확정된 뒤 한쪽만 그린다 — 랜딩을 기본값으로 두면 로그인 사용자에게 남의 첫 화면이
 * 한 프레임 스친다(RN 셸이 진입 경로를 직접 고르던 이유가 이거였다).
 *
 * 소개 화면은 `/start` 로도 그대로 남는다 — 로그아웃·탈퇴의 도착지이자 공유 링크의 CTA 라
 * 세션과 무관하게 주소로 가리킬 자리가 필요하고, 그쪽은 서버 렌더라 크롤러에도 보인다.
 */
export default function Page() {
  const state = useSessionState();
  // 여기서 세션이 만료되면 TripsView 가 통째로 언마운트돼 그 안의 SessionGuard 가 못 돈다.
  // 만료 안내와 로그인 화면 복귀는 그래서 이 자리에서 직접 챙긴다.
  useExpiredSessionExit(state === 'guest');

  if (state === 'pending') return <GuardPlaceholder />;
  return state === 'authenticated' ? <TripsView /> : <LandingView />;
}
