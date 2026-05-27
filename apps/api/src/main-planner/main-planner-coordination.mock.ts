import type { PlannerCoordinationDto, PlannerMemberDto } from '@tripick/types';

import { PLANNER_TRIP_MOCK } from './main-planner.mock';

/**
 * Trip 별 취향 조율 v1 mock.
 * 실제 데이터는 PreferenceModule + RAG 가 생성하지만, planner 탭 검수는 이 fixture 로 진행한다.
 *
 * NOTE: 기본 3명(태/박/홍) + 시트에서 추가된 친구의 이니셜은 voters 에 자동 합류시키지 않는다.
 * 동적 멤버 변경은 별도 mock 일관성 관리 비용이 커 backlog 로 미룬다.
 */
export const PLANNER_COORDINATION_MOCK: PlannerCoordinationDto = {
  tripId: PLANNER_TRIP_MOCK.id,
  members: [
    { id: 'm1', initial: '태', color: '#3182F6', tasteLabels: ['한식·전통', '카페'] },
    { id: 'm2', initial: '박', color: '#6B7684', tasteLabels: ['양식', '문화·역사'] },
    { id: 'm3', initial: '홍', color: '#191F28', tasteLabels: ['감성 코스', '도시'] },
  ],
  consensus: {
    food: [
      { key: 'cafe', label: '카페·디저트', count: 2, voters: ['태', '홍'] },
      { key: 'korean', label: '한식·전통', count: 2, voters: ['태', '박'] },
      { key: 'western', label: '양식', count: 1, voters: ['박'] },
    ],
    mood: [
      { key: 'cultural', label: '문화·역사', count: 2, voters: ['박', '태'] },
      { key: 'romantic', label: '감성 코스', count: 2, voters: ['홍', '태'] },
      { key: 'adventure', label: '액티비티', count: 0, voters: [] },
    ],
    environment: [
      { key: 'city', label: '도시·골목', count: 3, voters: ['태', '박', '홍'] },
      { key: 'nature', label: '자연·산', count: 1, voters: ['박'] },
      { key: 'village', label: '로컬 동네', count: 1, voters: ['홍'] },
    ],
  },
  recommendation: {
    title: '낮엔 유적, 저녁엔 감성 카페 코스',
    summary:
      '문화·역사 취향(2표)와 감성 코스(2표)가 균형을 이루고, 식사는 카페·한식이 동률입니다. 도시 중심 동선이 합의됐어요.',
    reasons: [
      '· 1일차 첨성대·황리단길은 문화·감성 모두 만족',
      '· 교리김밥으로 한식 표를 살리고, 황리단길 카페로 디저트 일정 보강',
      '· 모든 동선이 시내 반경 5km 안 → 이동 부담 최소',
    ],
    scheduleHint: '오전: 유적지 / 오후: 카페 거리 / 저녁: 한식 한 끼 패턴을 일정에 적용했어요.',
  },
};

const TASTE_SEEDS = [
  ['한식·전통', '도시·골목'],
  ['카페·디저트', '문화·역사'],
  ['감성 코스', '로컬 동네'],
  ['자연 산책', '대중교통'],
] as const;

export function buildPlannerCoordinationMock(
  tripId: string,
  members: PlannerMemberDto[],
): PlannerCoordinationDto {
  const normalizedMembers =
    members.length > 0 ? members : [{ id: 'empty', initial: '나', color: '#3182F6' }];
  const initials = normalizedMembers.map((member) => member.initial);
  const firstGroup = initials.slice(0, Math.max(1, Math.ceil(initials.length * 0.7)));
  const secondGroup = initials.slice(
    Math.max(0, initials.length - Math.max(1, Math.ceil(initials.length * 0.5))),
  );

  return {
    tripId,
    members: normalizedMembers.map((member, index) => {
      const tasteLabels = TASTE_SEEDS[index % TASTE_SEEDS.length] ?? TASTE_SEEDS[0];
      return {
        id: member.id,
        initial: member.initial,
        color: member.color,
        tasteLabels: [...tasteLabels],
      };
    }),
    consensus: {
      food: [
        { key: 'local', label: '로컬 맛집', count: firstGroup.length, voters: firstGroup },
        { key: 'cafe', label: '카페·디저트', count: secondGroup.length, voters: secondGroup },
        { key: 'korean', label: '한식·전통', count: 1, voters: initials.slice(0, 1) },
      ],
      mood: [
        { key: 'cultural', label: '문화·역사', count: firstGroup.length, voters: firstGroup },
        { key: 'romantic', label: '감성 코스', count: secondGroup.length, voters: secondGroup },
        { key: 'healing', label: '힐링', count: 1, voters: initials.slice(0, 1) },
      ],
      environment: [
        { key: 'city', label: '도시·골목', count: firstGroup.length, voters: firstGroup },
        { key: 'nature', label: '자연·산책', count: secondGroup.length, voters: secondGroup },
        { key: 'village', label: '로컬 동네', count: 1, voters: initials.slice(-1) },
      ],
    },
    recommendation: {
      title: `${normalizedMembers.length}명 취향 기준 절충 코스`,
      summary:
        '여행 멤버 구성이 바뀌면 이 조율 결과도 tripId 기준으로 다시 계산됩니다. 지금은 친구 목록 기반 mock 취향을 사용합니다.',
      reasons: [
        '· 멤버별 선호 태그를 합쳐 공통 분모가 큰 항목을 먼저 배치',
        '· 로컬 맛집과 감성 코스 선호가 충돌하지 않도록 반나절 단위로 분리',
        '· 같은 여행 안의 멤버 변경만 반영하고 다른 여행에는 섞이지 않음',
      ],
      scheduleHint: '멤버 추가/제외 후 조율 탭을 다시 열면 최신 멤버 기준으로 갱신됩니다.',
    },
  };
}
