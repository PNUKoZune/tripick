'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TripDto, TripMemberDto, TripMemberPreferenceDto } from '@tripick/types';
import {
  createTripMember,
  deleteTripMember,
  getTripMembers,
} from '@/entities/member/api/member-api';
import {
  MEMBER_ENVIRONMENT_OPTIONS,
  MEMBER_FOOD_OPTIONS,
  MEMBER_MOOD_OPTIONS,
} from '@/entities/preferences/model/options';
import { getStoredSession } from '@/entities/session/model/session-storage';
import { startDemoSession } from '@/entities/session/api/auth-api';
import { ensureActiveTrip } from '@/entities/trip/api/trip-api';
import {
  InlineNotice,
  PrimaryButton,
  SecondaryButton,
  SegmentedOption,
} from '@/shared/ui/app-frame';

const DEFAULT_MEMBER_PREF: TripMemberPreferenceDto = {
  food: ['korean'],
  mood: ['cultural'],
  environment: ['city'],
  transportMode: 'transit',
  budgetLevel: 'medium',
};

const PREFERENCE_LABELS: Record<string, string> = {
  korean: '한식·전통',
  cafe: '카페',
  western: '양식',
  healing: '힐링',
  cultural: '문화·역사',
  adventure: '액티비티',
  romantic: '감성 코스',
  family: '가족형',
  city: '도시',
  nature: '자연',
  village: '로컬 골목',
  mountain: '산·숲',
  transit: '대중교통',
  car: '자가용',
  walk: '도보',
  rental_car: '렌터카',
  low: '낮음',
  medium: '중간',
  high: '높음',
};

export function MemberManager() {
  const router = useRouter();
  const [trip, setTrip] = useState<TripDto | null>(null);
  const [members, setMembers] = useState<TripMemberDto[]>([]);
  const [nickname, setNickname] = useState('');
  const [contact, setContact] = useState('');
  const [preference, setPreference] = useState<TripMemberPreferenceDto>(DEFAULT_MEMBER_PREF);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const session = getStoredSession() ?? (await startDemoSession());
      const activeTrip = await ensureActiveTrip(session.tokens.accessToken);
      const nextMembers = await getTripMembers(session.tokens.accessToken, activeTrip.id);
      setTrip(activeTrip);
      setMembers(nextMembers);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '멤버 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMember() {
    const session = getStoredSession();
    if (!session || !trip || !nickname.trim()) {
      setMessage('이름을 입력하면 멤버를 추가할 수 있습니다.');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await createTripMember(session.tokens.accessToken, trip.id, {
        nickname,
        contact,
        status: contact.trim() ? 'pending' : 'accepted',
        preferenceTags: preference,
      });
      setNickname('');
      setContact('');
      setPreference(DEFAULT_MEMBER_PREF);
      setMembers(await getTripMembers(session.tokens.accessToken, trip.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '멤버 추가에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(memberId: string) {
    const session = getStoredSession();
    if (!session || !trip) {
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await deleteTripMember(session.tokens.accessToken, trip.id, memberId);
      setMembers(await getTripMembers(session.tokens.accessToken, trip.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '멤버 삭제에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-8 lg:gap-y-8 lg:space-y-0">
      <section className="lg:col-start-1">
        <div className="mb-4">
          <div className="text-[13px] font-bold text-[color:var(--text-tertiary)]">
            {trip?.title ?? '여행 준비 중'}
          </div>
          <h2 className="mt-1 text-[26px] font-black leading-8">새 멤버 추가</h2>
        </div>
        <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="이름"
            className="h-14 w-full rounded-[16px] bg-[color:var(--soft-bg)] px-4 text-[16px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[color:var(--blue-100)]"
          />
          <input
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            placeholder="전화번호 또는 카카오 ID"
            className="h-14 w-full rounded-[16px] bg-[color:var(--soft-bg)] px-4 text-[16px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[color:var(--blue-100)]"
          />
          <div className="lg:col-span-2">
            <PreferencePicker preference={preference} onChange={setPreference} />
          </div>
          <div className="lg:col-span-2 lg:max-w-[360px]">
            <PrimaryButton disabled={loading} onClick={handleAddMember}>
              멤버 추가
            </PrimaryButton>
          </div>
        </div>
      </section>

      <section className="border-t border-[color:var(--line)] pt-6 lg:col-start-2 lg:row-span-2 lg:border-t-0 lg:pt-0">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[18px] font-black leading-6">현재 멤버</h2>
          <span className="text-[13px] font-bold text-[color:var(--blue-600)]">
            {members.length}명
          </span>
        </div>
        <div className="divide-y divide-[color:var(--line)] border-y border-[color:var(--line)]">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 py-4">
              <div
                className={`flex size-11 shrink-0 items-center justify-center rounded-full text-[15px] font-black ${
                  member.role === 'owner'
                    ? 'bg-[color:var(--blue-600)] text-white'
                    : 'bg-[color:var(--soft-bg)] text-[color:var(--text-secondary)]'
                }`}
              >
                {member.nickname.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-[16px] font-bold">{member.nickname}</div>
                  <span className="rounded-full bg-[color:var(--soft-bg)] px-2 py-1 text-[11px] font-bold text-[color:var(--text-tertiary)]">
                    {member.role === 'owner'
                      ? '나'
                      : member.status === 'pending'
                        ? '대기 중'
                        : '참여'}
                  </span>
                </div>
                <div className="mt-1 truncate text-[13px] font-medium text-[color:var(--text-tertiary)]">
                  {formatPreferenceSummary(member.preferenceTags)}
                </div>
              </div>
              {member.role !== 'owner' ? (
                <button
                  type="button"
                  onClick={() => void handleDelete(member.id)}
                  className="px-2 py-2 text-[13px] font-bold text-[color:var(--text-tertiary)]"
                >
                  삭제
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-[color:var(--line)] pt-6 lg:col-start-1">
        <h2 className="mb-1 text-[18px] font-black leading-6">초대 방식</h2>
        <div className="divide-y divide-[color:var(--line)]">
          <InviteMethod title="카카오톡 초대" description="친구 목록 연동 예정" strong />
          <InviteMethod title="링크 초대" description="초대 링크 생성 예정" />
          <InviteMethod title="연락처 추가" description="위 입력창에서 바로 저장" />
        </div>
      </section>

      {message ? (
        <div className="lg:col-span-2">
          <InlineNotice title="상태" description={message} tone="red" />
        </div>
      ) : null}
      <div className="lg:col-span-2 lg:max-w-[360px]">
        <SecondaryButton
          disabled={loading || members.length === 0}
          onClick={() => router.push('/coordination')}
        >
          취향 조율 보기
        </SecondaryButton>
      </div>
    </div>
  );
}

function formatPreferenceSummary(preference: TripMemberPreferenceDto) {
  return [...preference.food, ...preference.mood]
    .map((value) => PREFERENCE_LABELS[value] ?? value)
    .join(' · ');
}

function InviteMethod({
  title,
  description,
  strong,
}: {
  title: string;
  description: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-4">
      <div>
        <div
          className={`text-[15px] font-black leading-5 ${
            strong ? 'text-[#191919]' : 'text-[color:var(--text-primary)]'
          }`}
        >
          {title}
        </div>
        <div className="mt-1 text-[13px] font-bold leading-5 text-[color:var(--text-tertiary)]">
          {description}
        </div>
      </div>
      <span
        className={`text-[20px] font-bold ${
          strong ? 'text-[#191919]' : 'text-[color:var(--text-tertiary)]'
        }`}
      >
        →
      </span>
    </div>
  );
}

function PreferencePicker({
  preference,
  onChange,
}: {
  preference: TripMemberPreferenceDto;
  onChange: (preference: TripMemberPreferenceDto) => void;
}) {
  return (
    <div className="space-y-4 pt-2">
      <PickerRow
        title="식사"
        options={MEMBER_FOOD_OPTIONS}
        value={preference.food[0]}
        onPick={(value) => onChange({ ...preference, food: [value] })}
      />
      <PickerRow
        title="관광"
        options={MEMBER_MOOD_OPTIONS}
        value={preference.mood[0]}
        onPick={(value) => onChange({ ...preference, mood: [value] })}
      />
      <PickerRow
        title="환경"
        options={MEMBER_ENVIRONMENT_OPTIONS}
        value={preference.environment[0]}
        onPick={(value) => onChange({ ...preference, environment: [value] })}
      />
    </div>
  );
}

function PickerRow({
  title,
  options,
  value,
  onPick,
}: {
  title: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string | undefined;
  onPick: (value: string) => void;
}) {
  return (
    <div className="border-t border-[color:var(--line)] pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 text-[13px] font-black text-[color:var(--text-secondary)]">{title}</div>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <SegmentedOption
            key={option.value}
            active={value === option.value}
            label={option.label}
            onClick={() => onPick(option.value)}
          />
        ))}
      </div>
    </div>
  );
}
