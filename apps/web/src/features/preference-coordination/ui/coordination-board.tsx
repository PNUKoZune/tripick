'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { PreferenceVoteDto } from '@tripick/types';
import { getPreferenceCoordination } from '@/entities/member/api/member-api';
import { getStoredSession } from '@/entities/session/model/session-storage';
import { startDemoSession } from '@/entities/session/api/auth-api';
import { ensureActiveTrip } from '@/entities/trip/api/trip-api';
import { queryKeys } from '@/shared/api/query-keys';
import { InlineNotice, PrimaryButton, SecondaryButton } from '@/shared/ui/app-frame';

export function CoordinationBoard() {
  const router = useRouter();
  const activeTripQuery = useQuery({
    queryKey: queryKeys.trips.active,
    queryFn: async () => {
      const session = getStoredSession() ?? (await startDemoSession());
      return ensureActiveTrip(session.tokens.accessToken);
    },
    staleTime: 5 * 60 * 1000,
  });

  const trip = activeTripQuery.data ?? null;
  const coordinationQuery = useQuery({
    queryKey: queryKeys.trips.coordination(trip?.id ?? 'pending'),
    queryFn: async () => {
      const session = getStoredSession() ?? (await startDemoSession());
      if (!trip) {
        throw new Error('여행 정보를 불러온 뒤 다시 시도해주세요.');
      }
      return getPreferenceCoordination(session.tokens.accessToken, trip.id);
    },
    enabled: Boolean(trip),
    staleTime: 30 * 1000,
  });

  const coordination = coordinationQuery.data ?? null;
  const loading = activeTripQuery.isFetching || coordinationQuery.isFetching;
  const message =
    activeTripQuery.error instanceof Error
      ? activeTripQuery.error.message
      : coordinationQuery.error instanceof Error
        ? coordinationQuery.error.message
        : null;

  const memberNames = useMemo(
    () => coordination?.members.map((member) => member.nickname).join(' · ') ?? '',
    [coordination],
  );

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[13px] font-bold text-[color:var(--text-tertiary)]">
              {trip?.title ?? '여행 준비 중'}
            </div>
            <h2 className="mt-1 text-[28px] font-black leading-9">
              {coordination ? `${coordination.members.length}명의 공통 취향` : '공통 취향 계산 중'}
            </h2>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void coordinationQuery.refetch()}
            className="h-9 rounded-full bg-[color:var(--soft-bg)] px-3 text-[13px] font-bold text-[color:var(--text-secondary)]"
          >
            새로고침
          </button>
        </div>
        {memberNames ? (
          <div className="mt-4 text-[14px] font-medium leading-6 text-[color:var(--text-secondary)]">
            {memberNames}
          </div>
        ) : null}
      </section>

      {coordination ? (
        <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 lg:space-y-0">
          <section>
            <h2 className="mb-2 text-[18px] font-black leading-6">취향 비교</h2>
            <div className="divide-y divide-[color:var(--line)] border-y border-[color:var(--line)]">
              <VoteLine title="식사 스타일" votes={coordination.consensus.food} />
              <VoteLine title="관광 취향" votes={coordination.consensus.mood} />
              <VoteLine title="선호 환경" votes={coordination.consensus.environment} />
              <VoteLine title="이동 수단" votes={coordination.consensus.transportMode} />
              <VoteLine title="예산 수준" votes={coordination.consensus.budgetLevel} />
            </div>
          </section>

          <section className="-mx-5 bg-[color:var(--blue-50)] px-5 py-6 lg:mx-0 lg:rounded-[24px] lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[18px] font-black leading-6 text-[color:var(--blue-800)]">
                AI 절충 추천
              </h2>
              <span className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-[color:var(--blue-700)]">
                자동 생성
              </span>
            </div>
            <div className="mt-4 text-[22px] font-black leading-8">
              {coordination.recommendation.title}
            </div>
            <p className="mt-2 text-[14px] font-medium leading-6 text-[color:var(--text-secondary)]">
              {coordination.recommendation.summary}
            </p>
            <div className="mt-4 space-y-2">
              {coordination.recommendation.reasons.map((reason) => (
                <div
                  key={reason}
                  className="text-[14px] font-semibold leading-5 text-[color:var(--blue-800)]"
                >
                  {reason}
                </div>
              ))}
            </div>
            <div className="mt-5 border-t border-[color:var(--blue-100)] pt-4 text-[14px] font-semibold leading-6 text-[color:var(--text-secondary)]">
              {coordination.recommendation.scheduleHint}
            </div>
          </section>
        </div>
      ) : null}

      {message ? <InlineNotice title="상태" description={message} tone="red" /> : null}
      <div className="space-y-3 lg:flex lg:max-w-[560px] lg:gap-3 lg:space-y-0">
        <PrimaryButton disabled={loading || !coordination} onClick={() => router.push('/')}>
          내 여행에서 일정 보기
        </PrimaryButton>
        <SecondaryButton disabled={loading} onClick={() => router.push('/members')}>
          멤버 추가해서 다시 조율
        </SecondaryButton>
      </div>
    </div>
  );
}

function VoteLine({ title, votes }: { title: string; votes: PreferenceVoteDto[] }) {
  const top = votes[0];
  const total = votes.reduce((sum, vote) => sum + vote.count, 0) || 1;

  return (
    <div className="py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[15px] font-black">{title}</div>
        <div className="text-[13px] font-bold text-[color:var(--text-tertiary)]">
          {top ? top.label : '대기'}
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {votes.slice(0, 3).map((vote) => (
          <div key={vote.key}>
            <div className="flex items-center justify-between text-[12px] font-bold text-[color:var(--text-tertiary)]">
              <span>{vote.label}</span>
              <span>{vote.memberNames.join(', ')}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-[color:var(--soft-bg)]">
              <div
                className="h-full rounded-full bg-[color:var(--blue-600)]"
                style={{ width: `${Math.max(16, (vote.count / total) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
