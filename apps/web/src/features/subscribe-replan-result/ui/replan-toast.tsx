'use client';

import { useEffect, useState } from 'react';

import { Toast } from '@/shared/ui';

import { useReplanSubscription } from '../model/use-replan-subscription';

export type ReplanSubscription = ReturnType<typeof useReplanSubscription>;

const STATUS_TONE = {
  completed: 'primary',
  failed: 'error',
  processing: 'neutral',
  pending: 'neutral',
} as const;

const STATUS_TITLE = {
  completed: 'AI가 일정을 새로 짰어요',
  failed: '재계획에 실패했어요',
  processing: 'AI가 일정을 다시 짜는 중…',
  pending: 'AI가 일정을 다시 짜는 중…',
} as const;

/**
 * planner 화면에 마운트해 재계획 결과·접근 거부를 실시간 토스트로 노출한다.
 * tripId 만 넘기면 구독·갱신·알림이 모두 처리된다.
 *
 * 이미 상위에서 구독 중이면 `subscription` 을 넘겨 중복 구독을 피할 수 있다
 * (예: Live 화면이 진행 핀과 토스트에 같은 구독을 공유).
 */
export function ReplanToast({
  tripId,
  subscription,
}: {
  tripId: string;
  subscription?: ReplanSubscription;
}) {
  // subscription 이 주어지면 자체 구독은 비활성화('' → no-op)
  const own = useReplanSubscription(subscription ? '' : tripId);
  const { latest, dismiss, accessDenied } = subscription ?? own;
  const [deniedDismissed, setDeniedDismissed] = useState(false);

  // 여행이 바뀌면 거부 안내 닫힘 상태를 초기화 (effect 대신 렌더 단계 조정).
  const [prevTripId, setPrevTripId] = useState(tripId);
  if (prevTripId !== tripId) {
    setPrevTripId(tripId);
    setDeniedDismissed(false);
  }

  // 완료 결과는 6초 뒤 자동으로 닫는다 (실패·거부는 사용자가 직접 닫도록 유지)
  useEffect(() => {
    if (latest?.status !== 'completed') return;
    const timer = setTimeout(dismiss, 6000);
    return () => clearTimeout(timer);
  }, [latest, dismiss]);

  if (accessDenied && !deniedDismissed) {
    return (
      <Toast
        tone="error"
        title="실시간 알림에 접근할 수 없어요"
        message="이 여행의 멤버만 실시간 업데이트를 받을 수 있어요."
        onClose={() => setDeniedDismissed(true)}
      />
    );
  }

  if (!latest) return null;

  return (
    <Toast
      tone={STATUS_TONE[latest.status]}
      title={STATUS_TITLE[latest.status]}
      {...(latest.explanation ? { message: latest.explanation } : {})}
      onClose={dismiss}
    />
  );
}
