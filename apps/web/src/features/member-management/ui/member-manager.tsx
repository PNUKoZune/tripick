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
    <div className="space-y-7">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[18px] font-bold leading-6">초대 방법</h2>
          <span className="text-[13px] font-bold text-[color:var(--text-tertiary)]">
            {trip?.title ?? '여행 준비 중'}
          </span>
        </div>
        <div className="space-y-2.5">
          <InviteMethod
            title="카카오톡으로 초대"
            description="키 연결 후 친구 목록 초대로 확장됩니다."
            strong
          />
          <InviteMethod
            title="링크로 초대"
            description="초대 링크 복사 API를 붙일 수 있게 분리했습니다."
          />
          <InviteMethod
            title="연락처에서 추가"
            description="전화번호 기반 대기 멤버로 저장합니다."
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[18px] font-bold leading-6">멤버 추가</h2>
        <div className="space-y-3">
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="이름"
            className="h-14 w-full rounded-[16px] border border-[color:var(--line)] bg-white px-4 text-[16px] font-bold outline-none focus:border-[color:var(--blue-500)]"
          />
          <input
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            placeholder="전화번호 또는 카카오 ID"
            className="h-14 w-full rounded-[16px] border border-[color:var(--line)] bg-white px-4 text-[16px] font-bold outline-none focus:border-[color:var(--blue-500)]"
          />
          <PreferencePicker preference={preference} onChange={setPreference} />
          <PrimaryButton disabled={loading} onClick={handleAddMember}>
            멤버 추가
          </PrimaryButton>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[18px] font-bold leading-6">현재 멤버</h2>
          <span className="text-[13px] font-bold text-[color:var(--blue-600)]">
            {members.length}명
          </span>
        </div>
        <div className="divide-y divide-[color:var(--line)] overflow-hidden rounded-[18px] border border-[color:var(--line)] bg-white">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 px-4 py-4">
              <div
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-[15px] font-black text-white"
                style={{ backgroundColor: member.color }}
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
                  {member.preferenceTags.food.join(', ')} · {member.preferenceTags.mood.join(', ')}
                </div>
              </div>
              {member.role !== 'owner' ? (
                <button
                  type="button"
                  onClick={() => void handleDelete(member.id)}
                  className="rounded-[12px] px-3 py-2 text-[13px] font-bold text-rose-500"
                >
                  삭제
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {message ? <InlineNotice title="상태" description={message} tone="red" /> : null}
      <SecondaryButton
        disabled={loading || members.length === 0}
        onClick={() => router.push('/coordination')}
      >
        취향 조율 보기
      </SecondaryButton>
    </div>
  );
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
    <div
      className={`flex items-center justify-between rounded-[18px] px-4 py-4 ${
        strong ? 'bg-[#FEE500] text-[#191919]' : 'border border-[color:var(--line)] bg-white'
      }`}
    >
      <div>
        <div className="text-[15px] font-black leading-5">{title}</div>
        <div className="mt-1 text-[13px] font-medium leading-5 opacity-70">{description}</div>
      </div>
      <span className="text-[20px] font-bold">→</span>
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
    <div className="space-y-3 rounded-[18px] bg-[color:var(--soft-bg)] p-3">
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
    <div>
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
