import type { CreateTripRequestDto, TripSummaryDto } from '@tripick/types';

import { PLANNER_TRIP_MOCK } from './main-planner.mock';

/**
 * 데모용 in-memory 저장소. 프로세스 재시작 시 초기화된다.
 * 신규 생성된 trip 은 상세 mock (PLANNER_TRIP_MOCK) 이 없으므로 hasDetail=false 로 둔다.
 */
export const TRIP_SUMMARIES_MOCK: TripSummaryDto[] = [
  {
    id: PLANNER_TRIP_MOCK.id,
    title: PLANNER_TRIP_MOCK.title,
    destination: '경주',
    startDate: PLANNER_TRIP_MOCK.meta.startDate,
    endDate: PLANNER_TRIP_MOCK.meta.endDate,
    durationLabel: PLANNER_TRIP_MOCK.meta.durationLabel,
    status: 'upcoming',
    statusLabel: '곧 출발',
    members: PLANNER_TRIP_MOCK.members,
    coverEmoji: '🏛️',
    highlight: '황리단길 카페·불국사 위주 1박 2일',
    itemCount: PLANNER_TRIP_MOCK.items.length,
    hasDetail: true,
  },
  {
    id: 'demo-busan-2n3d',
    title: '부산 2박 3일 감도 여행',
    destination: '부산',
    startDate: '2026-06-03',
    endDate: '2026-06-05',
    durationLabel: '2박 3일 · 6/3 수 ~ 6/5 금',
    status: 'draft',
    statusLabel: '초안',
    members: [
      { id: 'm1', initial: '태', color: '#3182F6' },
      { id: 'm2', initial: '박', color: '#6B7684' },
    ],
    coverEmoji: '🌊',
    highlight: '광안리·해운대·전포 카페거리',
    itemCount: 6,
    hasDetail: false,
  },
  {
    id: 'demo-jeju-3n4d',
    title: '제주 3박 4일 워케이션',
    destination: '제주',
    startDate: '2026-04-12',
    endDate: '2026-04-15',
    durationLabel: '3박 4일 · 4/12 일 ~ 4/15 수',
    status: 'done',
    statusLabel: '다녀옴',
    members: [
      { id: 'm1', initial: '태', color: '#3182F6' },
      { id: 'm2', initial: '박', color: '#6B7684' },
      { id: 'm3', initial: '홍', color: '#191F28' },
      { id: 'm4', initial: '민', color: '#00A86B' },
    ],
    coverEmoji: '🌴',
    highlight: '동쪽 해안 + 한라산 트래킹',
    itemCount: 12,
    hasDetail: false,
  },
  {
    id: 'demo-gangneung-day',
    title: '강릉 당일치기',
    destination: '강릉',
    startDate: '2026-07-20',
    endDate: '2026-07-20',
    durationLabel: '당일치기 · 7/20 월',
    status: 'draft',
    statusLabel: '초안',
    members: [{ id: 'm1', initial: '태', color: '#3182F6' }],
    coverEmoji: '☕',
    highlight: '안목해변 카페 + 회 한 끼',
    itemCount: 3,
    hasDetail: false,
  },
];

const STATUS_LABEL: Record<TripSummaryDto['status'], string> = {
  draft: '초안',
  upcoming: '곧 출발',
  ongoing: '진행 중',
  done: '다녀옴',
};

function formatDateLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} ${dow}`;
}

function buildDurationLabel(
  startDate: string,
  endDate: string,
  startTime?: string,
  endTime?: string,
) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const diff = Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const head = diff === 0 ? '당일치기' : `${diff}박 ${diff + 1}일`;
  const startLabel = `${formatDateLabel(startDate)}${startTime ? ` ${startTime}` : ''}`;
  const endLabel = `${formatDateLabel(endDate)}${endTime ? ` ${endTime}` : ''}`;
  return `${head} · ${startLabel} ~ ${endLabel}`;
}

function resolveStatus(startDate: string): TripSummaryDto['status'] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(`${startDate}T00:00:00`);
  const diffDays = Math.round((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'done';
  if (diffDays <= 30) return 'upcoming';
  return 'draft';
}

export function appendTripSummaryMock(input: CreateTripRequestDto): TripSummaryDto {
  const id = `trip-${Date.now().toString(36)}`;
  const status = resolveStatus(input.startDate);
  const summary: TripSummaryDto = {
    id,
    title: input.title,
    destination: input.destination,
    startDate: input.startDate,
    endDate: input.endDate,
    durationLabel: buildDurationLabel(
      input.startDate,
      input.endDate,
      input.startTime,
      input.endTime,
    ),
    status,
    statusLabel: STATUS_LABEL[status],
    members: input.members,
    coverEmoji: '🧳',
    highlight: input.notes?.trim() || '새로 생성된 여행 계획',
    itemCount: 0,
    hasDetail: false,
  };
  TRIP_SUMMARIES_MOCK.unshift(summary);
  return summary;
}
