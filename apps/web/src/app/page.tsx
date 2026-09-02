'use client';

import dynamic from 'next/dynamic';
import { GuardPlaceholder, useExpiredSessionExit, useSessionState } from '@/entities/session';

// localStorage 세션 판정 뒤 실제로 선택된 화면만 받는다. 정적 import 로 두면 비로그인
// 랜딩 방문자도 인증 전용 여행 목록 코드를, 로그인 사용자는 랜딩 코드를 함께 내려받는다.
const LandingView = dynamic(
  () => import('@/views/landing/ui/landing-view').then((module) => module.LandingView),
  { loading: () => <GuardPlaceholder /> },
);
const TripsView = dynamic(
  () => import('@/views/trips/ui/trips-view').then((module) => module.TripsView),
  { loading: () => <GuardPlaceholder /> },
);

/**
 * 루트(`/`)는 인증 상태로 갈린다 — 로그인했으면 홈(여행 목록), 아니면 소개(랜딩).
 *
 * 서버에서 못 가르는 이유: 세션이 쿠키가 아니라 localStorage(`tripick.session.v1`) 라
 * SSR 시점엔 존재를 알 수 없다. 그래서 판정 전('pending') 에는 가드와 같은 플레이스홀더를
 * 깔고 확정된 뒤 한쪽만 그린다 — 랜딩을 기본값으로 두면 로그인 사용자에게 남의 첫 화면이
 * 한 프레임 스친다(RN 셸이 진입 경로를 직접 고르던 이유가 이거였다).
 *
 * 소개 화면 전용 주소(`/start`)는 없앴다 — 그쪽도 로그인 상태면 여기로 되돌려 보내던 터라
 * 결국 같은 화면 두 벌이었고, canonical 없이 같은 내용이 두 주소에 걸려 있었다. 밖에 나간
 * 링크만 살리려고 `/start` → `/` 영구 리다이렉트를 next.config 에 남겨 뒀다.
 *
 * ⚠️ 대신 이 화면의 HTML 에는 랜딩 본문이 담기지 않는다(판정 전이라 플레이스홀더만 나간다).
 * 랜딩을 크롤러에게 보여야 할 때가 오면 세션 힌트를 서버가 읽게 만들어 여기서 갈라야 한다.
 */
export default function Page() {
  const state = useSessionState();
  // 여기서 세션이 만료되면 TripsView 가 통째로 언마운트돼 그 안의 SessionGuard 가 못 돈다.
  // 만료 안내와 로그인 화면 복귀는 그래서 이 자리에서 직접 챙긴다.
  useExpiredSessionExit(state === 'guest');

  if (state === 'pending') return <GuardPlaceholder />;
  return state === 'authenticated' ? <TripsView /> : <LandingView />;
}
