'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PreferenceCoordinationDto, PreferenceVoteDto, TripDto } from '@tripick/types';
import { getPreferenceCoordination } from '@/entities/member/api/member-api';
import { getStoredSession } from '@/entities/session/model/session-storage';
import { startDemoSession } from '@/entities/session/api/auth-api';
import { ensureActiveTrip } from '@/entities/trip/api/trip-api';
import { InlineNotice, PrimaryButton, SecondaryButton } from '@/shared/ui/app-frame';

export function CoordinationBoard() {
  const router = useRouter();
  const [trip, setTrip] = useState<TripDto | null>(null);
  const [coordination, setCoordination] = useState<PreferenceCoordinationDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const memberNames = useMemo(
    () => coordination?.members.map((member) => member.nickname).join(' · ') ?? '',
    [coordination],
  );

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const session = getStoredSession() ?? (await startDemoSession());
      const activeTrip = await ensureActiveTrip(session.tokens.accessToken);
      const nextCoordination = await getPreferenceCoordination(
        session.tokens.accessToken,
        activeTrip.id,
      );
      setTrip(activeTrip);
      setCoordination(nextCoordination);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '취향 조율 결과를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-7">
      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[13px] font-bold text-[color:var(--text-tertiary)]">
              {trip?.title ?? '여행 준비 중'}
            </div>
            <h2 className="mt-1 text-[24px] font-black leading-8 tracking-[-0.02em]">
              멤버 취향을 한 기준으로 맞췄어요
            </h2>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="h-9 rounded-full bg-[color:var(--blue-50)] px-3 text-[13px] font-bold text-[color:var(--blue-700)]"
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
        <>
          <section className="space-y-3">
            <h2 className="text-[18px] font-bold leading-6">취향 비교</h2>
            <VoteLine title="식사 스타일" votes={coordination.consensus.food} />
            <VoteLine title="관광 취향" votes={coordination.consensus.mood} />
            <VoteLine title="선호 환경" votes={coordination.consensus.environment} />
            <VoteLine title="이동 수단" votes={coordination.consensus.transportMode} />
            <VoteLine title="예산 수준" votes={coordination.consensus.budgetLevel} />
          </section>

          <section className="rounded-[22px] border border-[color:var(--blue-100)] bg-[color:var(--blue-50)] px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[18px] font-black leading-6 text-[color:var(--blue-800)]">
                AI 절충 추천
              </h2>
              <span className="rounded-full bg-white/80 px-3 py-1 text-[12px] font-bold text-[color:var(--blue-700)]">
                자동 생성
              </span>
            </div>
            <div className="mt-4 text-[20px] font-black leading-7 tracking-[-0.01em]">
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
            <div className="mt-4 rounded-[16px] bg-white px-4 py-3 text-[14px] font-semibold leading-6 text-[color:var(--text-secondary)]">
              {coordination.recommendation.scheduleHint}
            </div>
          </section>
        </>
      ) : null}

      {message ? <InlineNotice title="상태" description={message} tone="red" /> : null}
      <PrimaryButton disabled={loading || !coordination} onClick={() => router.push('/members')}>
        멤버 추가해서 다시 조율
      </PrimaryButton>
      <SecondaryButton disabled={loading} onClick={() => router.push('/preferences')}>
        내 취향 다시 설정
      </SecondaryButton>
    </div>
  );
}

function VoteLine({ title, votes }: { title: string; votes: PreferenceVoteDto[] }) {
  const top = votes[0];
  const total = votes.reduce((sum, vote) => sum + vote.count, 0) || 1;

  return (
    <div className="rounded-[18px] border border-[color:var(--line)] bg-white px-4 py-4">
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
